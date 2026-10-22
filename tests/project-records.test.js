import { test,before,after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory=mkdtempSync(path.join(tmpdir(),'pmo-project-records-')),password='project-record-test-passphrase';
let child,port,admin,chris,taylor,outsider,portfolio,program,project,privateProject;
async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',PMO_ACCESS_TOKEN:'project-record-bootstrap',SEED_DEMO:'false'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server stopped'));});});}
const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
async function req(route,method='GET',data,actor=admin){const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});const body=await response.json();return {status:response.status,data:body,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:body.csrf};}
async function invite(name,email,role,projectIds){const i=await req('admin/users','POST',{name,email,role,projectIds});assert.equal(i.status,201);const actor=await req('auth/accept','POST',{token:i.data.token,password},null);assert.equal(actor.status,200);return actor;}
const projectInput=name=>({name,status:'Active',budget:100,forecast:100});
before(async()=>{port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});await start();admin=await req('auth/setup','POST',{setupToken:'project-record-bootstrap',organization:'Records customer',name:'Admin',email:'admin@example.test',password},null);assert.equal(admin.status,201);portfolio=(await req('portfolios','POST',{name:'Portfolio A'})).data;program=(await req('programs','POST',{name:'Program A',portfolioId:portfolio.id})).data;project=(await req('projects','POST',{...projectInput('Project A'),portfolioId:portfolio.id,programId:program.id})).data;privateProject=(await req('projects','POST',projectInput('Private project'))).data;chris=await invite('Chris','chris@example.test','contributor',[project.id]);taylor=await invite('Taylor','taylor@example.test','contributor',[project.id]);outsider=await invite('Outsider','outsider@example.test','manager',[privateProject.id]);});
after(async()=>{await stop();rmSync(directory,{recursive:true,force:true});});

test('new customers have no change orders or status updates',async()=>{
 const w=await req('workspace');assert.deepEqual(w.data.changeOrders,[]);assert.deepEqual(w.data.statusUpdates,[]);
});
test('project updates persist with server timestamps, revisions and project-scoped visibility',async()=>{
 for(const kind of ['changeOrders','statusUpdates']){
  const input={name:'Delivery update',reportDate:'2026-10-22',description:'Review completed',projectId:project.id,...(kind==='changeOrders'?{status:'Submitted',budgetImpact:-250,scheduleImpact:-2}:{})};
  const r=await req(kind,'POST',input,chris);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.authorId,chris.data.user.id);assert.ok(r.data.createdAt);assert.equal(r.data.revision,1);
  assert.equal((await req(kind+'/'+r.data.id,'GET',undefined,taylor)).status,200);
  assert.equal((await req(kind+'/'+r.data.id,'GET',undefined,outsider)).status,404);
  assert.equal((await req('workspace','GET',undefined,outsider)).data[kind].length,0);
  assert.equal((await req(kind+'/'+r.data.id,'PATCH',{revision:1,description:'Updated'},chris)).status,200);
  assert.equal((await req(kind+'/'+r.data.id,'PATCH',{revision:1,description:'Stale'},chris)).status,409);
  assert.equal((await req(kind+'/'+r.data.id,'PATCH',{revision:2,projectId:privateProject.id})).status,400);
  assert.equal((await req(kind,'POST',{...input,projectId:privateProject.id},chris)).status,404);
 }
 const p=(await req('projects/'+project.id)).data;assert.equal(p.budget,100);assert.equal(p.forecast,100);
 const snapshot=(await req('workspace')).data;await stop();await start();const again=(await req('workspace')).data;assert.deepEqual(again.statusUpdates,snapshot.statusUpdates);assert.deepEqual(again.changeOrders,snapshot.changeOrders);
});
test('project records validate details and financial and schedule impacts',async()=>{
 const input={name:'Change',description:'Details',projectId:project.id,status:'Draft',budgetImpact:0,scheduleImpact:0};
 for(const patch of [{description:''},{budgetImpact:'bad'},{scheduleImpact:0.5},{status:'Done'},{projectId:'missing'}])assert.equal((await req('changeOrders','POST',{...input,...patch})).status,400);
 assert.equal((await req('statusUpdates','POST',{name:'Update',projectId:project.id,description:42})).status,400);
});
test('viewers cannot add or edit project records',async()=>{
 const viewer=await invite('Reader','reader@example.test','viewer',[project.id]);
 for(const kind of ['changeOrders','statusUpdates']){
  assert.equal((await req(kind,'POST',{name:'Denied',description:'Details',projectId:project.id},viewer)).status,403);
  const record=(await req('workspace')).data[kind][0];assert.equal((await req(kind+'/'+record.id,'PATCH',{revision:record.revision,description:'Denied'},viewer)).status,403);
 }
});

test('status reports require real dates and have generated labels without user-entered titles',async()=>{
 const input={projectId:project.id,description:'Dated report'};
 for(const reportDate of [undefined,'','2026-02-30','bad',42])assert.equal((await req('statusUpdates','POST',{...input,reportDate})).status,400);
 const result=await req('statusUpdates','POST',{...input,reportDate:'2026-10-10'});assert.equal(result.status,201);assert.equal(result.data.reportDate,'2026-10-10');assert.equal(result.data.name,'Status report — 2026-10-10');
 const update=await req('statusUpdates/'+result.data.id,'PATCH',{revision:result.data.revision,reportDate:'2026-10-20'});assert.equal(update.status,200);assert.equal(update.data.reportDate,'2026-10-20');assert.equal(update.data.createdAt,result.data.createdAt);
});

test('existing status reports retain their text and use submission dates when edited',async()=>{
 const legacy={id:'legacy-status-report',projectId:project.id,name:'Original title',description:'Historical update',createdAt:'2026-09-20T14:30:00.000Z',revision:1};const database=new DatabaseSync(path.join(directory,'pmo.sqlite'));database.prepare('INSERT INTO records VALUES(?,?,?)').run(legacy.id,'statusUpdates',JSON.stringify(legacy));database.close();
 const before=(await req('workspace')).data.statusUpdates.find(r=>r.id===legacy.id);assert.equal(before.description,'Historical update');assert.equal(before.reportDate,undefined);
 const edited=await req('statusUpdates/'+legacy.id,'PATCH',{revision:1,description:'Historical update corrected'});assert.equal(edited.status,200);assert.equal(edited.data.reportDate,'2026-09-20');assert.equal(edited.data.createdAt,legacy.createdAt);
});


test('workstream links are restricted to the same project across registers',async()=>{
 const stream=(await req('workstreams','POST',{name:'Delivery stream',projectId:project.id})).data;
 const foreign=(await req('workstreams','POST',{name:'Private stream',projectId:privateProject.id})).data;
 for(const [kind,fields] of [['raid',{type:'Risk',severity:'High',status:'Open'}],['changeOrders',{description:'Scope',status:'Draft',budgetImpact:20,scheduleImpact:1}],['financialEntries',{entryType:'Actual',amount:25,entryDate:'2026-10-22'}]]){
  const input={name:'Linked '+kind,projectId:project.id,workstreamId:stream.id,...fields};const result=await req(kind,'POST',input,chris);assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.workstreamId,stream.id);
  assert.equal((await req(kind,'POST',{...input,workstreamId:foreign.id},chris)).status,400);
  assert.equal((await req(kind+'/'+result.data.id,'PATCH',{revision:result.data.revision,workstreamId:'missing'},chris)).status,400);
  assert.equal((await req(kind+'/'+result.data.id,'GET',undefined,outsider)).status,404);
  assert.equal((await req('workspace','GET',undefined,outsider)).data[kind].some(r=>r.id===result.data.id),false);
 }
});
test('financial entries validate amounts, types and dates and never change project totals',async()=>{
 const input={name:'Actual cost',projectId:project.id,entryType:'Actual',amount:45.5,entryDate:'2026-10-22'};
 for(const patch of [{amount:-1},{amount:'bad'},{entryType:'Other'},{entryDate:'2026-02-30'}])assert.equal((await req('financialEntries','POST',{...input,...patch})).status,400);
 const record=await req('financialEntries','POST',input);assert.equal(record.status,201);assert.equal(record.data.currency,'USD');assert.equal(record.data.amount,45.5);
 const viewer=await invite('Finance reader','finance-reader@example.test','viewer',[project.id]);assert.equal((await req('financialEntries','POST',input,viewer)).status,403);assert.equal((await req('financialEntries/'+record.data.id,'PATCH',{revision:record.data.revision,amount:50},viewer)).status,403);
 const before=(await req('projects/'+project.id)).data;assert.equal(before.budget,100);assert.equal(before.forecast,100);
 const snapshot=(await req('workspace')).data.financialEntries;await stop();await start();assert.deepEqual((await req('workspace')).data.financialEntries,snapshot);
});


test('project resource, transparency and escalation registers persist with access checks',async()=>{
 const reader=await invite('New register reader','register-reader@example.test','viewer',[project.id]);
 for(const [kind,status] of [['resources','Planned'],['transparencies','Open'],['escalations','Open']]){
  const input={name:'Project '+kind,projectId:project.id,description:'Project details',owner:'Chris',status,due:'2026-12-01'};const result=await req(kind,'POST',input,chris);assert.equal(result.status,201,JSON.stringify(result.data));
  assert.equal((await req(kind,'POST',{...input,status:'Invalid'})).status,400);assert.equal((await req(kind,'POST',{...input,projectId:privateProject.id},chris)).status,404);
  assert.equal((await req(kind,'POST',input,reader)).status,403);assert.equal((await req(kind+'/'+result.data.id,'GET',undefined,outsider)).status,404);assert.equal((await req('workspace','GET',undefined,outsider)).data[kind].length,0);
  const snapshot=(await req('workspace')).data[kind];await stop();await start();assert.deepEqual((await req('workspace')).data[kind],snapshot);
 }
});


test('user workstream assignments persist without granting access and clear when project access is removed',async()=>{
 const stream=(await req('workstreams','POST',{name:'User stream',projectId:project.id})).data,foreign=(await req('workstreams','POST',{name:'Other user stream',projectId:privateProject.id})).data;
 const input={name:'Workstream user',email:'workstream-user@example.test',role:'viewer',projectIds:[project.id],workstreamId:stream.id};
 assert.equal((await req('admin/users','POST',{...input,workstreamId:foreign.id})).status,400);assert.equal((await req('admin/users')).data.users.some(u=>u.email===input.email),false);
 assert.equal((await req('admin/users','POST',{...input,workstreamId:42})).status,400);
 const created=await req('admin/users','POST',input);assert.equal(created.status,201);assert.equal(created.data.user.workstreamId,stream.id);assert.deepEqual(created.data.user.projectIds,[project.id]);
 const accepted=await req('auth/accept','POST',{token:created.data.token,password},null);assert.equal(accepted.status,200);assert.equal((await req('auth/me','GET',undefined,accepted)).data.user.workstreamId,stream.id);
 await stop();await start();let user=(await req('admin/users')).data.users.find(u=>u.id===created.data.user.id);assert.equal(user.workstreamId,stream.id);
 const removed=await req('admin/users/'+user.id,'PATCH',{revision:user.revision,projectIds:[]});assert.equal(removed.status,200);assert.equal(removed.data.user.workstreamId,'');assert.deepEqual(removed.data.user.projectIds,[]);
 user=removed.data.user;const restored=await req('admin/users/'+user.id,'PATCH',{revision:user.revision,projectIds:[project.id],workstreamId:stream.id});assert.equal(restored.status,200);assert.equal(restored.data.user.workstreamId,stream.id);
 const cleared=await req('admin/users/'+user.id,'PATCH',{revision:restored.data.user.revision,workstreamId:''});assert.equal(cleared.status,200);assert.equal(cleared.data.user.workstreamId,'');
});
