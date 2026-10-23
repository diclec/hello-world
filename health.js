import './public/health-core.js';
const H=globalThis.PmoHealth,DAY=86400000;
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
export function projectHealthMetrics(project,records,now=new Date()){
 const today=now.toISOString().slice(0,10),day=Date.parse(today),days=date=>Math.max(0,Math.floor((day-Date.parse(date))/DAY));
 const tasks=records.tasks||[],parents=new Set(tasks.map(t=>t.parentId).filter(Boolean)),leaves=tasks.filter(t=>!parents.has(t.id));
 const dated=leaves.filter(t=>t.finishDate&&Number.isFinite(Date.parse(t.finishDate)));
 const dates=leaves.filter(t=>Number(t.percentComplete??(t.status==='Done'?100:0))<100&&t.finishDate&&Number.isFinite(Date.parse(t.finishDate)));
 const schedule=dated.length||numeric(project.slip)?Math.max(0,numeric(project.slip)?project.slip:0,...dates.map(t=>days(t.finishDate))):null;
 const resources=records.resources||[],complete=resources.length&&resources.every(r=>numeric(r.allocatedHours)&&numeric(r.utilizedHours)),allocated=resources.reduce((n,r)=>n+(r.allocatedHours||0),0),used=resources.reduce((n,r)=>n+(r.utilizedHours||0),0);
 const datesReported=(records.statusUpdates||[]).map(r=>r.reportDate||r.createdAt?.slice(0,10)).filter(d=>d&&Number.isFinite(Date.parse(d)));if(!datesReported.length&&project.lastReport&&Number.isFinite(Date.parse(project.lastReport)))datesReported.push(project.lastReport);
 const raid=(records.raid||[]).filter(r=>r.status!=='Resolved'),count=type=>raid.filter(r=>r.type===type&&['High','Critical'].includes(r.severity)).length;
 return {schedule,budget:numeric(project.budget)&&project.budget>0&&numeric(project.forecast)?Math.max(0,(project.forecast-project.budget)/project.budget*100):null,resources:complete?(allocated>0?used/allocated*100:used>0?1000000:null):null,risk:count('Risk'),issues:count('Issue'),reporting:datesReported.length?days(datesReported.sort().at(-1)):null,dependencies:raid.filter(r=>r.type==='Dependency'&&r.due&&r.due<today).length};
}
export function createHealth({db,all,auth}){
 db.exec('CREATE TABLE IF NOT EXISTS health_settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
 const settings=()=>{const row=db.prepare('SELECT data FROM health_settings WHERE id=1').get();return row?JSON.parse(row.data):H.defaults();};
 function enrich(project,config=settings(),records){
  const source=records||Object.fromEntries(['tasks','raid','resources','statusUpdates'].map(k=>[k,all(k)]));
  const metrics=projectHealthMetrics(project,Object.fromEntries(Object.entries(source).map(([k,rs])=>[k,rs.filter(r=>r.projectId===project.id)])));
  const details=H.evaluate([{...project,healthMetrics:metrics}],config.levels.project);
  return {...project,healthMetrics:metrics,...(config.enabled?{health:details.health,healthDetails:details}:{} )};
 }
 async function handle(req,url,actor,send,input){
  if(url.pathname!=='/api/admin/health-settings')return false;auth.admin(actor);
  if(req.method==='GET'){send(200,settings());return true;}
  if(req.method==='PUT'){
   const value=H.validate(input),old=settings();if(value.revision!==old.revision){send(409,{error:'Health settings changed. Reload Administration before saving.'});return true;}
   value.revision++;value.updatedAt=new Date().toISOString();value.updatedBy=actor.id;
   auth.transaction(()=>{db.prepare('INSERT INTO health_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(value));auth.audit(actor,'health.settings.updated','health-settings',{revision:value.revision,levels:value.levels});});send(200,value);return true;
  }send(405,{error:'Method not allowed'});return true;
 }
 return {settings,enrich,handle};
}
