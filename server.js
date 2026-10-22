import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAuth, readJSON } from './auth.js';
import { createHierarchy } from './hierarchy.js';
import { createSchedule } from './schedule.js';
import { createAssignments } from './assignments.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root,'.data'); mkdirSync(dataDir,{recursive:true,mode:0o700});
const db = new DatabaseSync(path.join(dataDir,'pmo.sqlite')); db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);');
db.exec('CREATE TABLE IF NOT EXISTS health_snapshots(project_id TEXT NOT NULL, day TEXT NOT NULL, health TEXT NOT NULL, PRIMARY KEY(project_id,day));');
const all = kind => db.prepare('SELECT data FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.data));
const get = id => { const r=db.prepare('SELECT data FROM records WHERE id=?').get(id); return r&&JSON.parse(r.data); };
const put = (kind,r) => db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(r.id,kind,JSON.stringify(r));
const today = new Date(); const date = n => { const d=new Date(today);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); };
if(!get('initialized')){
 if(process.env.SEED_DEMO==='true'){
 const rows=[
 ['p1','Hospital network integration','Infrastructure','Sarah Mitchell','SM','Active',68,2400000,2260000,0,'Connect Northstar Hospital’s clinical and enterprise networks with a secure, resilient infrastructure.','Jun 15, 2027'],
 ['p2','Zero Trust security rollout','Cybersecurity','James Chen','JC','Active',42,850000,918000,5,'Introduce identity-first access and endpoint protection across the organization.','Jul 30, 2027'],
 ['p3','Patient experience platform','Digital transformation','Emily Parker','EP','Active',81,1200000,1170000,0,'Create a connected digital journey for patients and care teams.','May 28, 2027'],
 ['p4','ERP cloud migration','Enterprise systems','Michael Torres','MT','Active',35,1800000,2070000,14,'Modernize finance and operations on a shared cloud platform.','Sep 10, 2027'],
 ['p5','Clinical data interoperability','Infrastructure','Sarah Mitchell','SM','Authorized',18,650000,650000,0,'Enable secure clinical data exchange between care providers.','Oct 22, 2027'],
 ['p6','Workplace modernization','Digital transformation','Alex Morgan','AM','Closing',94,420000,403000,0,'Deliver a flexible, accessible workplace for every team.','Apr 30, 2027']
 ];
 for(const [id,name,category,owner,initials,status,progress,budget,forecast,slip,description,target] of rows) put('projects',{id,name,category,owner,initials,status,progress,budget,forecast,currency:'USD',slip,description,target,revision:1,demo:true,createdAt:new Date().toISOString(),lastReport:date(-2)});
 for(const [id,name] of [['w1','Discovery & assessment'],['w2','Connectivity & segmentation'],['w3','Testing & cutover']]) put('workstreams',{id,name,projectId:'p1',revision:1,demo:true});
 [['Network discovery and asset inventory','Done','w1',-4],['Approve segmentation design','In progress','w2',2],['Validate clinical device connectivity','In progress','w2',4],['Prepare cutover and rollback plan','To do','w3',7],['Clinical owner acknowledgement','To do','w3',10]].forEach(([name,status,workstreamId,due],i)=>put('tasks',{id:'t'+i,name,status,workstreamId,projectId:'p1',owner:i%2?'James Chen':'Sarah Mitchell',due:date(due),revision:1,demo:true}));
 [['r1','Risk','Legacy devices may not support network segmentation','High','Sarah Mitchell','p1',3],['r2','Issue','ERP data mapping requires vendor resolution','Critical','Michael Torres','p4',-2],['r3','Decision','Approve revised security rollout window','High','James Chen','p2',1],['r4','Dependency','Identity platform readiness for cutover','Medium','Sarah Mitchell','p1',6]].forEach(([id,type,name,severity,owner,projectId,due])=>put('raid',{id,type,name,severity,owner,projectId,due:date(due),status:'Open',probability:3,impact:4,revision:1,demo:true}));
 }
 put('meta',{id:'initialized'});
}
function health(p){const issues=all('raid').some(r=>r.projectId===p.id&&r.type==='Issue'&&r.severity==='Critical'&&r.status!=='Resolved');const variance=p.budget?(p.forecast-p.budget)/p.budget:null;const stale=p.lastReport&&Date.now()-Date.parse(p.lastReport)>7*86400000;const overdueRisk=all('raid').some(r=>r.projectId===p.id&&r.type==='Risk'&&['High','Critical'].includes(r.severity)&&r.status!=='Resolved'&&r.due&&r.due<new Date().toISOString().slice(0,10)); if(issues||p.slip>10||variance>.1)return 'At risk'; if(p.slip>0||variance>0||stale||overdueRisk)return 'Needs attention';if(!p.budget||!p.lastReport)return 'Unknown';return 'On track';}
const host = process.env.HOST || '127.0.0.1';
const auth = createAuth(db,{dataDir,host});
const hierarchy=createHierarchy({all,put,auth});
const assignments=createAssignments({all,auth,db});
const schedule=createSchedule({all,put,auth,db,assignments});
schedule.refreshExisting();
const types=['projects','tasks','raid','workstreams','changeOrders','statusUpdates','financialEntries'];
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url,'http://localhost'); const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
 if(url.pathname.startsWith('/api/')){
 auth.checkOrigin(req);
 if(await auth.handle(req,res,url,send))return;
 if(!['GET','HEAD'].includes(req.method))await readJSON(req);
 const actor=auth.requireUser(req);
 if(await hierarchy.handle(req,url,actor,send))return;
 const assigneesRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/assignees$/);
 if(assigneesRoute&&req.method==='GET')return send(200,{users:assignments.list(actor,assigneesRoute[1])});
 if(url.pathname==='/api/my-work'&&req.method==='GET'){
 const tasks=assignments.forActor(actor),ids=new Set(tasks.map(t=>t.projectId)),projects=all('projects').filter(p=>ids.has(p.id)),visible=hierarchy.visible(actor);
 return send(200,{tasks,projects,programs:visible.programs.filter(p=>projects.some(r=>r.programId===p.id)),portfolios:visible.portfolios.filter(p=>projects.some(r=>r.portfolioId===p.id))});
 }
 if(url.pathname==='/api/workspace'&&req.method==='GET'){
 const projects=all('projects').filter(p=>auth.canRead(actor,p.id)).map(p=>({...p,health:health(p)}));const ids=new Set(projects.map(p=>p.id));
 const snapshotDay=new Date().toISOString().slice(0,10);const cutoff=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
 const snapshot=db.prepare('INSERT INTO health_snapshots VALUES(?,?,?) ON CONFLICT(project_id,day) DO UPDATE SET health=excluded.health WHERE health<>excluded.health');
 auth.transaction(()=>{for(const p of projects)snapshot.run(p.id,snapshotDay,p.health);});
 const healthHistory=projects.flatMap(p=>db.prepare('SELECT day,health FROM health_snapshots WHERE project_id=? AND day>=? ORDER BY day').all(p.id,cutoff).map(r=>({projectId:p.id,...r})));
 return send(200,{...hierarchy.visible(actor),projects,healthHistory,financialEntries:all('financialEntries').filter(r=>ids.has(r.projectId)),changeOrders:all('changeOrders').filter(r=>ids.has(r.projectId)),statusUpdates:all('statusUpdates').filter(r=>ids.has(r.projectId)),myTaskIds:assignments.forActor(actor).map(t=>t.id),tasks:all('tasks').filter(r=>ids.has(r.projectId)),raid:all('raid').filter(r=>ids.has(r.projectId)),workstreams:all('workstreams').filter(r=>ids.has(r.projectId))});
 }
 if(url.pathname==='/api/demo'&&req.method==='DELETE'){auth.admin(actor);db.exec('BEGIN');try{const userRecords=types.filter(k=>k!=='projects').flatMap(all).filter(r=>!r.demo);const retainedTasks=new Set(userRecords.filter(r=>r.projectId).flatMap(r=>[r.parentId,...(r.dependsOn||[])]).filter(Boolean));let grew=true;while(grew){grew=false;for(const t of all('tasks'))if(retainedTasks.has(t.id))for(const id of [t.parentId,...(t.dependsOn||[])].filter(Boolean))if(!retainedTasks.has(id)){retainedTasks.add(id);grew=true;}}const retainedProjects=new Set([...userRecords,...all('tasks').filter(t=>retainedTasks.has(t.id))].map(r=>r.projectId));const retainedStreams=new Set(userRecords.map(r=>r.workstreamId));for(const kind of types)for(const r of all(kind))if(r.demo){if((kind==='tasks'&&retainedTasks.has(r.id))||(kind==='projects'&&retainedProjects.has(r.id))||(kind==='workstreams'&&retainedStreams.has(r.id))){put(kind,{...r,demo:false,revision:r.revision+1});}else db.prepare('DELETE FROM records WHERE id=?').run(r.id);}auth.audit(actor,'demo.removed');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(200,{ok:true});}
 const [, ,kind,id]=url.pathname.split('/');if(!types.includes(kind))return send(404,{error:'Not found'});
 if(req.method==='GET'&&id){const record=all(kind).find(r=>r.id===id);if(!record||!auth.canRead(actor,kind==='projects'?id:record.projectId))return send(404,{error:'Record not found'});return send(200,kind==='projects'?{...record,health:health(record)}:record);}
 const input=await readJSON(req);
 if(kind==='tasks'&&id&&req.method==='DELETE'){schedule.remove(actor,id,input);return send(200,{ok:true});}
 if(req.method==='POST'||req.method==='PATCH'){
 const old=id&&get(id);if(id&&(!old||!all(kind).some(r=>r.id===id)))return send(404,{error:'Record not found'});
 auth.authorizeWrite(actor,kind,old,input);
 if(old&&old.revision!==input.revision)return send(409,{error:'This record changed. Refresh and try again.'});
 if(kind==='workstreams'&&old&&input.projectId&&old.projectId!==input.projectId)return send(400,{error:'Workstreams cannot move between projects'});
 const r={...(old||{}),...input,id:old?.id||randomUUID(),revision:(old?.revision||0)+1,demo:old?.demo||false,createdAt:old?.createdAt||new Date().toISOString(),authorId:old?.authorId||actor.id,updatedBy:actor.id,updatedAt:new Date().toISOString()};
 for(const key of ['owner','category','description','response','currency','target','due','status','type','severity','workstreamId','projectId'])if(r[key]!==undefined&&(typeof r[key]!=='string'||r[key].length>10000))return send(400,{error:'Invalid '+key});
 if(kind==='statusUpdates'){
 if(input.reportDate===undefined&&old)r.reportDate=old.reportDate||old.createdAt?.slice(0,10);
 if(!PmoSchedule.validDate(r.reportDate))return send(400,{error:'Enter a valid report date'});
 r.name='Status report — '+r.reportDate;
 }
 if(typeof r.name!=='string'||!r.name.trim())return send(400,{error:'A name is required'});r.name=r.name.trim().slice(0,240);
 if(kind!=='projects'&&!all('projects').some(p=>p.id===r.projectId))return send(400,{error:'Select a valid project'});
 const project=kind==='projects'?old:get(r.projectId);if(project?.status==='Closed'||(kind!=='projects'&&old&&get(old.projectId)?.status==='Closed'))return send(409,{error:'Closed projects are read-only'});
 if(kind==='projects'){
 hierarchy.validateProject(actor,r);
 r.category=r.category||'Infrastructure';r.owner=r.owner||actor.name;
 if(!['Draft','Pending Authorization','Authorized','Active','Closing','Closed','On Hold','Canceled'].includes(r.status))return send(400,{error:'Invalid project status'});
 if(['Closed','Canceled'].includes(r.status))return send(400,{error:'Controlled closure and cancellation are not available in this increment'});
 for(const key of ['actuals','committedCosts'])if(Object.hasOwn(r,key)){if(r[key]===''||r[key]===null)delete r[key];else if(!['number','string'].includes(typeof r[key])||!String(r[key]).trim()||!Number.isFinite(Number(r[key]))||Number(r[key])<0)return send(400,{error:'Actuals and committed costs must be nonnegative numbers, or blank when unrecorded'});else r[key]=Number(r[key]);}
 for(const key of ['budget','forecast'])if(!Number.isFinite(Number(r[key]))||Number(r[key])<0)return send(400,{error:'Costs must be nonnegative numbers'});else r[key]=Number(r[key]);
 if(!['USD','EUR','GBP','CAD','AUD'].includes(r.currency||'USD'))return send(400,{error:'Unsupported currency'});r.currency=r.currency||'USD'; r.progress=Number(r.progress)||0;r.slip=Number(r.slip)||0;
 }
 if(kind==='financialEntries'){
 if(!['Budget','Actual','Committed','Forecast'].includes(r.entryType))return send(400,{error:'Select a valid financial record type'});
 if(!['number','string'].includes(typeof r.amount)||!String(r.amount).trim()||!Number.isFinite(Number(r.amount))||Number(r.amount)<0)return send(400,{error:'Amount must be a nonnegative number'});
 if(!PmoSchedule.validDate(r.entryDate))return send(400,{error:'Enter a valid financial record date'});
 r.amount=Number(r.amount);r.currency=project.currency||'USD';
 }
 if(kind==='tasks'&&!['To do','In progress','Done','Blocked'].includes(r.status))return send(400,{error:'Invalid task status'});
 if(['tasks','raid','changeOrders','financialEntries'].includes(kind)&&r.workstreamId&&!all('workstreams').some(w=>w.id===r.workstreamId&&w.projectId===r.projectId))return send(400,{error:'Workstream must belong to the project'});
 if(kind==='raid'&&(!['Risk','Assumption','Issue','Dependency','Decision','Action'].includes(r.type)||!['Open','In progress','Resolved'].includes(r.status)))return send(400,{error:'Invalid RAID type or status'});
 if(kind==='raid'){if(!['Low','Medium','High','Critical'].includes(r.severity))return send(400,{error:'Invalid severity'});if(r.type==='Risk')for(const key of ['probability','impact']){r[key]=Number(r[key]||3);if(!Number.isInteger(r[key])||r[key]<1||r[key]>5)return send(400,{error:'Risk scores must be integers from 1 to 5'});}}
 if(['changeOrders','statusUpdates'].includes(kind)){
 if(old&&input.projectId&&input.projectId!==old.projectId)return send(400,{error:'Project records cannot move between projects'});
 if(typeof r.description!=='string'||!r.description.trim())return send(400,{error:'Enter the update or change details'});
 if(kind==='changeOrders'){
 if(!['Draft','Submitted','Approved','Rejected'].includes(r.status))return send(400,{error:'Invalid change order status'});
 for(const key of ['budgetImpact','scheduleImpact']){if(!['number','string'].includes(typeof r[key])||!String(r[key]).trim()||!Number.isFinite(Number(r[key]))||(key==='scheduleImpact'&&!Number.isInteger(Number(r[key]))))return send(400,{error:'Enter a valid budget impact and whole-day schedule impact'});r[key]=Number(r[key]);}
 }
 }
 if(r.due&&!/^\d{4}-\d{2}-\d{2}$/.test(r.due))return send(400,{error:'Use a valid due date'});
 if(kind==='tasks')return send(old?200:201,schedule.save(actor,input,old,r));
 auth.transaction(()=>{put(kind,r);if(kind==='projects'&&!old)auth.grantCreator(actor,r.id);auth.audit(actor,kind+(old?'.updated':'.created'),r.id,{projectId:kind==='projects'?r.id:r.projectId,revision:r.revision});});return send(old?200:201,r);
 }
 return send(405,{error:'Method not allowed'});
 }
 const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','identity.js','portfolios.js','overview.js','my-work.js','financials.js','schedule-core.js','schedule.js','styles.css'].includes(file)){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(readFileSync(path.join(root,'public',file)));
 }catch(e){send(e.status||(e instanceof SyntaxError?400:500),{error:e.status?e.message:e instanceof SyntaxError?'Invalid JSON':'Request failed'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(process.env.PORT||3000,host,()=>console.log(`PathToo PMO listening on ${host}:${process.env.PORT||3000}`));
