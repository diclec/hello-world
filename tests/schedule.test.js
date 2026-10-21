import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import '../public/schedule-core.js';
import { DatabaseSync } from 'node:sqlite';
const dir=mkdtempSync(path.join(tmpdir(),'pmo-schedule-'));
let child,port,admin,viewer,contributor,outsider,project,other,parent,a,b,milestone;
const password='schedule-test-passphrase';
async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',PMO_ACCESS_TOKEN:'schedule-bootstrap-code',SEED_DEMO:'false'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timed out')),10000);child.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Unexpected server exit'));});});}
const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
async function req(route,method='GET',data,actor=admin){const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});const body=await response.json();return {status:response.status,data:body,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:body.csrf};}
async function invite(name,role,ids=[]){const i=await req('admin/users','POST',{name,email:name+'@example.test',role,projectIds:ids});assert.equal(i.status,201);return req('auth/accept','POST',{token:i.data.token,password},null);}
const create=async data=>{const result=await req('tasks','POST',{name:'Task',projectId:project.id,status:'To do',...data});assert.equal(result.status,201,JSON.stringify(result.data));return result.data;};
const task=async id=>(await req('tasks/'+id)).data;
const patch=async(id,data)=>req('tasks/'+id,'PATCH',{revision:(await task(id)).revision,...data});
before(async()=>{port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});await start();admin=await req('auth/setup','POST',{setupToken:'schedule-bootstrap-code',organization:'Schedule customer',name:'Admin',email:'admin@example.test',password},null);assert.equal(admin.status,201);project=(await req('projects','POST',{name:'Schedule project',status:'Active',budget:100,forecast:100})).data;other=(await req('projects','POST',{name:'Other project',status:'Active',budget:100,forecast:100})).data;viewer=await invite('viewer','viewer',[project.id]);contributor=await invite('contributor','contributor',[project.id]);outsider=await invite('outsider','manager',[other.id]);});
after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('WBS hierarchy, calendar durations, summary rollups, completion and milestones use shared rules',async()=>{
 parent=await create({name:'Delivery'});
 a=await create({name:'Design',parentId:parent.id,startDate:'2026-11-02',duration:3,percentComplete:50});
 b=await create({name:'Build',parentId:parent.id,dependsOn:[a.id],duration:4});
 assert.equal(a.finishDate,'2026-11-04');assert.equal(b.startDate,'2026-11-04');assert.equal(b.finishDate,'2026-11-07');
 milestone=await create({name:'Ready',dependsOn:[b.id],duration:0,percentComplete:0});assert.equal(milestone.startDate,'2026-11-07');assert.equal(milestone.finishDate,milestone.startDate);
 const summary=await task(parent.id);assert.equal(summary.startDate,'2026-11-02');assert.equal(summary.finishDate,'2026-11-07');assert.equal(summary.duration,6);assert.equal(summary.percentComplete,21);
 const rows=PmoSchedule.calculate((await req('workspace')).data.tasks).rows;assert.deepEqual(rows.map(r=>r.wbs),['1','1.1','1.2','2']);assert.equal(rows[0].summary,true);
});
test('predecessor changes reschedule all successors in either direction, increment revisions and audit atomically',async()=>{
 const beforeB=await task(b.id),beforeM=await task(milestone.id);
 const beforeWbs=PmoSchedule.calculate((await req('workspace')).data.tasks.filter(t=>t.projectId===project.id)).rows.map(r=>[r.task.id,r.wbs]);
 assert.equal((await patch(a.id,{startDate:'2026-11-10'})).status,200);
 assert.equal((await task(b.id)).startDate,'2026-11-12');assert.equal((await task(milestone.id)).startDate,'2026-11-15');assert.equal((await task(parent.id)).finishDate,'2026-11-15');
 assert.equal((await req('tasks/'+b.id,'PATCH',{revision:beforeB.revision,name:'Stale'})).status,409);
 assert.equal((await task(milestone.id)).revision,beforeM.revision+1);
 assert.equal((await patch(a.id,{startDate:'2026-11-01'})).status,200);assert.equal((await task(b.id)).startDate,'2026-11-03');
 const events=(await req('admin/audit')).data.events;assert.ok(events.some(e=>e.action==='schedule.recalculated'));
 assert.deepEqual(PmoSchedule.calculate((await req('workspace')).data.tasks.filter(t=>t.projectId===project.id)).rows.map(r=>[r.task.id,r.wbs]),beforeWbs);
});
test('invalid dates, durations, percentages, cross-project references and cycles leave all records unchanged',async()=>{
 const snapshot=(await req('workspace')).data.tasks;
 for(const data of [{startDate:'2026-02-30'},{startDate:'2026-13-01'},{startDate:4},{startDate:'1800-01-01'},{duration:-1},{duration:1.5},{duration:'3'},{percentComplete:101},{percentComplete:-1},{dependsOn:[a.id]},{dependsOn:'a'},{dependsOn:[b.id,b.id]},{dependsOn:[parent.id]},{parentId:b.id},{parentId:a.id}])assert.equal((await patch(a.id,data)).status,400,JSON.stringify(data));
 assert.equal((await patch(a.id,{dependsOn:[b.id]})).status,400);
 assert.equal((await patch(parent.id,{parentId:a.id})).status,400);
 const foreign=await create({projectId:other.id,name:'Foreign',startDate:'2026-11-01',duration:1});
 for(const data of [{parentId:foreign.id},{dependsOn:[foreign.id]},{projectId:other.id}])assert.equal((await patch(a.id,data)).status,400);
 assert.equal((await req('workspace')).data.tasks.filter(t=>t.projectId===project.id).length,snapshot.length);
 assert.deepEqual((await req('workspace')).data.tasks.filter(t=>t.projectId===project.id),snapshot);
});
test('unscheduled legacy work stays unscheduled and due dates survive; finish dates can calculate durations',async()=>{
 const legacy=await create({name:'Unscheduled',due:'2026-12-03'});assert.equal(legacy.due,'2026-12-03');assert.equal(legacy.startDate,undefined);
 const scheduled=await create({name:'Date entry',startDate:'2026-12-01',finishDate:'2026-12-03'});assert.equal(scheduled.duration,3);
 assert.equal((await patch(scheduled.id,{finishDate:'2026-11-30'})).status,400);
 assert.equal((await patch(scheduled.id,{startDate:'2026-12-01',finishDate:'2026-12-10',duration:3})).status,400);
 assert.equal((await patch(scheduled.id,{startDate:'',finishDate:''})).status,200);assert.equal((await task(scheduled.id)).startDate,'');assert.equal((await task(scheduled.id)).due,'');
 assert.equal((await patch(legacy.id,{status:'Done'})).status,200);assert.equal((await task(legacy.id)).percentComplete,100);assert.equal((await task(legacy.id)).due,'2026-12-03');
 assert.equal((await patch(legacy.id,{status:'To do'})).status,200);assert.equal((await task(legacy.id)).percentComplete,0);
 const before=(await req('workspace')).data.tasks;
 assert.equal((await patch(legacy.id,{dependsOn:[scheduled.id]})).status,400);assert.deepEqual((await req('workspace')).data.tasks,before);
});
test('multiple predecessors control start dates, nested summaries and milestone successors schedule correctly',async()=>{
 const c=await create({name:'Parallel',startDate:'2026-11-20',duration:2});
 const d=await create({name:'Merge',dependsOn:[a.id,c.id],duration:2,startDate:'2026-11-25'});assert.equal(d.startDate,'2026-11-21');
 assert.equal((await patch(c.id,{startDate:'2026-12-01'})).status,200);assert.equal((await task(d.id)).startDate,'2026-12-02');
 assert.equal((await patch(c.id,{startDate:'2026-11-20'})).status,200);assert.equal((await task(d.id)).startDate,'2026-11-21');
 assert.equal((await patch(d.id,{startDate:'2027-01-01'})).status,200);assert.equal((await task(d.id)).startDate,'2026-11-21');
 const nested=await create({name:'Nested summary',parentId:parent.id});await create({name:'Nested leaf',parentId:nested.id,startDate:'2026-11-15',duration:2,percentComplete:100});assert.equal((await task(nested.id)).percentComplete,100);assert.equal((await task(parent.id)).finishDate,'2026-11-16');
 const successor=await create({name:'After milestone',duration:1,dependsOn:[milestone.id]});assert.equal(successor.startDate,(await task(milestone.id)).finishDate);
 assert.equal((await patch(parent.id,{dependsOn:[c.id]})).status,400);
});
test('task permissions apply to schedule writes, deletes and direct reads',async()=>{
 assert.equal((await req('tasks/'+a.id,'PATCH',{revision:(await task(a.id)).revision,duration:2},viewer)).status,403);
 assert.equal((await req('tasks/'+a.id,'DELETE',{revision:(await task(a.id)).revision},viewer)).status,403);
 assert.equal((await req('tasks/'+a.id,'GET',undefined,outsider)).status,404);
 assert.equal((await req('tasks/'+a.id,'PATCH',{revision:(await task(a.id)).revision,percentComplete:20},outsider)).status,404);
 const r=await req('tasks/'+a.id,'PATCH',{revision:(await task(a.id)).revision,percentComplete:80},contributor);assert.equal(r.status,200);assert.equal(r.data.status,'In progress');
 assert.equal((await req('workspace','GET',undefined,viewer)).data.tasks.some(t=>t.projectId===other.id),false);
});
test('deleting a referenced task is refused; removing an independent leaf preserves WBS and survives restart',async()=>{
 assert.equal((await req('tasks/'+parent.id,'DELETE',{revision:(await task(parent.id)).revision})).status,409);
 assert.equal((await req('tasks/'+a.id,'DELETE',{revision:(await task(a.id)).revision})).status,409);
 const independent=await create({name:'Remove me'});assert.equal((await req('tasks/'+independent.id,'DELETE',{revision:0})).status,409);assert.equal((await req('tasks/'+independent.id,'DELETE',{revision:independent.revision})).status,200);assert.equal((await req('tasks/'+independent.id)).status,404);
 const snapshot=(await req('workspace')).data;await stop();await start();assert.deepEqual((await req('workspace')).data,snapshot);
});

test('upgrade restart recalculates existing linked dates and is idempotent',async()=>{
 const before=(await req('workspace')).data.tasks,expected=before.find(t=>t.id===b.id);await stop();
 const database=new DatabaseSync(path.join(dir,'pmo.sqlite'));
 const stale={...expected,startDate:PmoSchedule.shift(expected.startDate,1),finishDate:PmoSchedule.shift(expected.finishDate,1),due:PmoSchedule.shift(expected.finishDate,1)};
 database.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(stale),b.id);database.close();
 await start();const restored=await task(b.id);assert.equal(restored.startDate,expected.startDate);assert.equal(restored.finishDate,expected.finishDate);assert.equal(restored.due,expected.finishDate);assert.equal(restored.revision,expected.revision+1);assert.equal(restored.updatedBy,null);
 const events=(await req('admin/audit')).data.events;assert.ok(events.some(e=>e.action==='schedule.recalculated'));
 const snapshot=(await req('workspace')).data;await stop();await start();assert.deepEqual((await req('workspace')).data,snapshot);
});
