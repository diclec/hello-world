import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'pathtoo-test-'));const port=3100;let child;
const start=async()=>{child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),PMO_ACCESS_TOKEN:'test-owner-token'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('listening'))resolve();});child.once('exit',()=>reject(Error('Server exited before ready')));});};
const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
const req=async(route,method='GET',data,auth=true)=>{const r=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-owner-token'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};};
before(start);after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('unauthenticated direct API reads and mutations are denied',async()=>{assert.equal((await req('workspace','GET',null,false)).status,401);assert.equal((await req('projects','POST',{name:'Unauthorized'},false)).status,401);});
test('fictional portfolio health reconciles with forecast and critical issues',async()=>{const {data}=await req('workspace');assert.equal(data.projects.length,6);assert.equal(data.projects.find(p=>p.id==='p4').health,'At risk');assert.equal(data.projects.find(p=>p.id==='p2').health,'Needs attention');assert.equal(data.tasks.length,5);});
test('create project, workstream, task and RAID; stale edits conflict; records survive restart',async()=>{
let r=await req('projects','POST',{name:'User project',owner:'Alex',category:'Infrastructure',status:'Draft',budget:100,forecast:100,currency:'USD'});assert.equal(r.status,201);const p=r.data;
r=await req('workstreams','POST',{name:'Discovery',projectId:p.id});assert.equal(r.status,201);const w=r.data;
r=await req('tasks','POST',{name:'Validate network',projectId:p.id,workstreamId:w.id,status:'To do'});assert.equal(r.status,201);const task=r.data;
r=await req('tasks/'+task.id,'PATCH',{revision:task.revision,status:'Done'});assert.equal(r.status,200);assert.equal(r.data.status,'Done');
r=await req('tasks/'+task.id,'PATCH',{revision:task.revision,status:'Blocked'});assert.equal(r.status,409);
r=await req('tasks','POST',{name:'Cross-project reference',projectId:'p1',workstreamId:w.id,status:'To do'});assert.equal(r.status,400);
r=await req('raid','POST',{name:'Vendor dependency',projectId:p.id,type:'Dependency',status:'Open',severity:'High'});assert.equal(r.status,201);
await stop();await start();const snapshot=(await req('workspace')).data;assert.equal(snapshot.projects.find(x=>x.id===p.id).name,'User project');assert.equal(snapshot.tasks.find(x=>x.id===task.id).status,'Done');
});
test('invalid inputs cannot create broken project references or budgets',async()=>{assert.equal((await req('tasks','POST',{name:'Bad',projectId:'missing',status:'To do'})).status,400);assert.equal((await req('projects','POST',{name:'Bad',status:'Active',budget:-1,forecast:0})).status,400);});
test('missing reporting is unknown and completed risks stop affecting health',async()=>{const p=(await req('workspace')).data.projects.find(p=>!p.demo);assert.equal(p.health,'Unknown');const r=await req('raid','POST',{name:'Overdue response',projectId:p.id,type:'Risk',status:'Open',severity:'High',due:'2020-01-01',probability:4,impact:5});assert.equal(r.status,201);assert.equal((await req('workspace')).data.projects.find(x=>x.id===p.id).health,'Needs attention');assert.equal((await req('raid/'+r.data.id,'PATCH',{revision:1,status:'Resolved'})).status,200);});
test('demo removal preserves user-created records and remains removed after restart',async()=>{assert.equal((await req('demo','DELETE')).status,200);await stop();await start();const data=(await req('workspace')).data;assert.equal(data.projects.filter(p=>p.demo).length,0);assert.equal(data.projects.length,1);assert.equal(data.tasks.length,1);assert.equal(data.raid.length,2);});

test('unimplemented closure cannot be bypassed through the API',async()=>{const p=(await req('workspace')).data.projects[0];assert.equal((await req('projects/'+p.id,'PATCH',{revision:p.revision,status:'Closed'})).status,400);});
