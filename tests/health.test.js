import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import '../public/health-core.js';
import {projectHealthMetrics} from '../health.js';
const H=globalThis.PmoHealth;
const policy=(weights,extra={})=>{const p=H.defaults().levels.project;for(const [key,d] of Object.entries(p.dimensions))d.weight=weights[key]||0;return {...p,...extra};};
const row=(metrics,status='Active')=>({status,healthMetrics:metrics});

test('weights change health, normalize automatically, and disabled dimensions have no effect',()=>{
 const records=[row({schedule:11,budget:0,risk:20})];
 const schedule=H.evaluate(records,policy({schedule:80,budget:20}));assert.equal(schedule.score,80);assert.equal(schedule.health,'At risk');assert.equal(schedule.coverage,100);
 const budget=H.evaluate(records,policy({schedule:10,budget:90}));assert.equal(budget.score,10);assert.equal(budget.health,'On track');
 assert.equal(H.evaluate(records,policy({schedule:2,budget:2})).score,50);
});
test('dimension and overall threshold boundaries are inclusive',()=>{
 const p=policy({schedule:100},{amber:50,red:100});
 assert.equal(H.evaluate([row({schedule:0.99})],p).health,'On track');
 assert.equal(H.evaluate([row({schedule:1})],p).health,'Needs attention');
 assert.equal(H.evaluate([row({schedule:11})],p).health,'At risk');
});
test('missing data policies report coverage and never assume missing metrics are healthy',()=>{
 const records=[row({schedule:11,budget:0}),row({schedule:null,budget:0})];
 const p=policy({schedule:50,budget:50});assert.equal(H.evaluate(records,p).health,'Unknown');assert.equal(H.evaluate(records,p).score,null);assert.equal(H.evaluate(records,p).coverage,75);
 const available=H.evaluate(records,{...p,missingData:'available'});assert.equal(available.score,50);assert.equal(available.coverage,75);
 assert.equal(H.evaluate([row({})],{...p,missingData:'available'}).health,'Unknown');
});
test('program and portfolio formulas independently score dimensions and exclude closed projects',()=>{
 const config=H.defaults(),records=[row({schedule:11,budget:0}),row({schedule:0,budget:0}),row({schedule:999,budget:999},'Closed')];
 config.levels.program=policy({budget:100});config.levels.portfolio=policy({schedule:100});
 assert.equal(H.evaluate(records,config.levels.program).health,'On track');assert.equal(H.evaluate(records,config.levels.portfolio).score,50);
 config.levels.portfolio.dimensions.schedule.red=20;assert.equal(H.evaluate(records,config.levels.portfolio).score,25);
 assert.equal(H.evaluate([row({},'Closed')],config.levels.project).health,'No active delivery');
});
test('settings validation rejects malformed, nonfinite, reversed or empty formulas',()=>{
 assert.equal(H.validate(H.defaults()).enabled,true);
 for(const change of [c=>c.revision=-1,c=>c.levels.project.dimensions.schedule.weight=-1,c=>c.levels.program.red=20,c=>c.levels.portfolio.missingData='ignore',c=>c.levels.project.dimensions.risk.red=0,c=>c.levels.project.dimensions.budget.weight='50',c=>c.levels.program.dimensions.budget.red=Infinity,c=>{for(const d of Object.values(c.levels.project.dimensions))d.weight=0;},c=>delete c.levels.portfolio]){const value=H.defaults();change(value);assert.throws(()=>H.validate(value));}
});
test('metrics use leaf schedules, project forecasts, resource hours, RAID records and newest status dates',()=>{
 const now=new Date('2026-10-23T12:00:00Z'),project={budget:100,forecast:120,lastReport:'2026-10-23',slip:2};
 const records={tasks:[{id:'parent',finishDate:'2026-01-01'},{id:'child',parentId:'parent',finishDate:'2026-10-20',percentComplete:20},{id:'complete',finishDate:'2026-01-01',percentComplete:100}],resources:[{allocatedHours:80,utilizedHours:40},{allocatedHours:20,utilizedHours:70}],raid:[{type:'Risk',severity:'Critical',status:'Open'},{type:'Risk',severity:'High',status:'Resolved'},{type:'Issue',severity:'High',status:'Open'},{type:'Dependency',due:'2026-10-22',status:'Open'}],statusUpdates:[{reportDate:'2026-10-10'},{reportDate:'2026-10-15'}]};
 const metrics=projectHealthMetrics(project,records,now);assert.equal(metrics.schedule,3);assert.equal(metrics.budget,20);assert.ok(Math.abs(metrics.resources-110)<1e-8);assert.equal(metrics.risk,1);assert.equal(metrics.issues,1);assert.equal(metrics.dependencies,1);assert.equal(metrics.reporting,8);
 records.resources.push({name:'Unrecorded'});assert.equal(projectHealthMetrics(project,records,now).resources,null);
 assert.equal(projectHealthMetrics({}, {tasks:[{id:'done',finishDate:'2026-10-01',status:'Done'}]},now).schedule,0);
 const missing=projectHealthMetrics({}, {},now);assert.equal(missing.schedule,null);assert.equal(missing.resources,null);assert.equal(missing.budget,null);assert.equal(missing.reporting,null);assert.equal(missing.risk,0);
 assert.equal(projectHealthMetrics({lastReport:'2026-10-20'},{},now).reporting,3);
});

const directory=mkdtempSync(path.join(tmpdir(),'pmo-health-')),otherDirectory=mkdtempSync(path.join(tmpdir(),'pmo-health-other-')),password='health-scoring-test-passphrase';
let server,otherServer,port,otherPort,admin,viewer,manager,project;
async function start(directory,port){const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',SEED_DEMO:'false',PMO_ACCESS_TOKEN:'health-test-bootstrap'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server stopped'));});});return child;}
const stop=child=>new Promise(resolve=>{if(!child||child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
const freePort=()=>new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
async function req(route,method='GET',data,actor=admin,target=port){const response=await fetch(`http://127.0.0.1:${target}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});const value=await response.json();return {status:response.status,data:value,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:value.csrf};}
async function invite(role){const result=await req('admin/users','POST',{name:role,email:role+'@example.test',role,projectIds:[project.id]});return req('auth/accept','POST',{token:result.data.token,password},null);}
before(async()=>{port=await freePort();otherPort=await freePort();server=await start(directory,port);admin=await req('auth/setup','POST',{setupToken:'health-test-bootstrap',organization:'Scored Customer',name:'Admin',email:'admin@example.test',password},null);project=(await req('projects','POST',{name:'Scored project',status:'Active',budget:100,forecast:100,slip:11,lastReport:'2026-10-22'})).data;viewer=await invite('viewer');manager=await invite('manager');});
after(async()=>{await stop(server);await stop(otherServer);rmSync(directory,{recursive:true,force:true});rmSync(otherDirectory,{recursive:true,force:true});});

test('only admins can edit health formulas; first save activates scoring and updates workspace/project APIs',async()=>{
 const defaults=await req('admin/health-settings');assert.equal(defaults.status,200);assert.equal(defaults.data.enabled,false);
 assert.equal((await req('admin/health-settings','GET',undefined,null)).status,401);
 for(const actor of [viewer,manager]){assert.equal((await req('admin/health-settings','GET',undefined,actor)).status,403);assert.equal((await req('admin/health-settings','PUT',defaults.data,actor)).status,403);}
 assert.equal((await req('admin/health-settings','PUT',defaults.data,{...admin,csrf:'wrong'})).status,403);
 const value=defaults.data;value.levels.project=policy({schedule:100});value.levels.program=policy({budget:100});value.levels.portfolio=policy({risk:100});
 const save=await req('admin/health-settings','PUT',value);assert.equal(save.status,200,JSON.stringify(save.data));assert.equal(save.data.revision,1);assert.equal(save.data.enabled,true);
 const workspace=(await req('workspace')).data,p=workspace.projects.find(p=>p.id===project.id);assert.equal(p.health,'At risk');assert.equal(p.healthDetails.score,100);assert.equal(p.healthMetrics.schedule,11);assert.equal(workspace.healthSettings.revision,1);
 assert.equal((await req('projects/'+project.id)).data.healthDetails.score,100);
 const hidden=(await req('projects','POST',{name:'Hidden project',status:'Active',budget:100,forecast:200,slip:99})).data;assert.equal((await req('projects/'+hidden.id,'GET',undefined,viewer)).status,404);
 const reader=(await req('workspace','GET',undefined,viewer)).data;assert.equal(reader.healthSettings.revision,1);assert.equal(reader.projects.length,1);assert.equal(reader.projects[0].health,'At risk');
 const audit=(await req('admin/audit')).data.events;assert.ok(audit.some(e=>e.action==='health.settings.updated'&&e.details.revision===1));
});
test('settings revisions prevent overwrites and invalid settings leave saved formulas intact',async()=>{
 const old=(await req('admin/health-settings')).data;const changed=structuredClone(old);changed.levels.project=policy({budget:100});const save=await req('admin/health-settings','PUT',changed);assert.equal(save.status,200);assert.equal(save.data.revision,2);assert.equal((await req('projects/'+project.id)).data.health,'On track');
 assert.equal((await req('admin/health-settings','PUT',old)).status,409);const bad=save.data;bad.levels.project.red=0;assert.equal((await req('admin/health-settings','PUT',bad)).status,400);assert.equal((await req('admin/health-settings')).data.revision,2);
});
test('health settings persist across restarts and stay isolated between customer installations',async()=>{
 const saved=(await req('admin/health-settings')).data;await stop(server);server=await start(directory,port);assert.deepEqual((await req('admin/health-settings')).data,saved);assert.equal((await req('projects/'+project.id)).data.healthDetails.score,0);
 otherServer=await start(otherDirectory,otherPort);const second=await req('auth/setup','POST',{setupToken:'health-test-bootstrap',organization:'Other Customer',name:'Owner',email:'other@example.test',password},null,otherPort);const untouched=await req('admin/health-settings','GET',undefined,second,otherPort);assert.equal(untouched.data.enabled,false);assert.equal(untouched.data.revision,0);
});
