import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory=mkdtempSync(path.join(tmpdir(),'pmo-my-work-')),password='my-work-test-passphrase';
let child,port,admin,chris,taylor,twin,outsider,portfolio,program,project,privateProject,owned,other,legacy,emailLegacy;
async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',PMO_ACCESS_TOKEN:'my-work-bootstrap',SEED_DEMO:'false'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server stopped'));});});}
const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
async function req(route,method='GET',data,actor=admin){const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});const body=await response.json();return {status:response.status,data:body,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:body.csrf};}
async function invite(name,email,role,projectIds){const i=await req('admin/users','POST',{name,email,role,projectIds});assert.equal(i.status,201);const actor=await req('auth/accept','POST',{token:i.data.token,password},null);assert.equal(actor.status,200);return actor;}
const projectInput=name=>({name,status:'Active',budget:100,forecast:100});
const create=async data=>{const r=await req('tasks','POST',{name:'Assigned task',projectId:project.id,status:'To do',...data});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
const taskIds=result=>result.data.tasks.map(t=>t.id).sort();
function seedLegacy(task){const db=new DatabaseSync(path.join(directory,'pmo.sqlite'));db.prepare('INSERT INTO records VALUES(?,?,?)').run(task.id,'tasks',JSON.stringify(task));db.close();return task;}
before(async()=>{port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});await start();admin=await req('auth/setup','POST',{setupToken:'my-work-bootstrap',organization:'Work customer',name:'Admin',email:'admin@example.test',password},null);assert.equal(admin.status,201);portfolio=(await req('portfolios','POST',{name:'Portfolio A'})).data;program=(await req('programs','POST',{name:'Program A',portfolioId:portfolio.id})).data;project=(await req('projects','POST',{...projectInput('Project A'),portfolioId:portfolio.id,programId:program.id})).data;privateProject=(await req('projects','POST',projectInput('Private project'))).data;chris=await invite('Chris','chris@example.test','contributor',[project.id]);taylor=await invite('Taylor','taylor@example.test','contributor',[project.id]);outsider=await invite('Outsider','outsider@example.test','manager',[privateProject.id]);});
after(async()=>{await stop();rmSync(directory,{recursive:true,force:true});});
test('project ownership, authorship and empty containers do not assign work to the actor',async()=>{
 assert.deepEqual(taskIds(await req('my-work')),[]);assert.deepEqual(taskIds(await req('my-work','GET',undefined,chris)),[]);
 assert.deepEqual((await req('workspace','GET',undefined,chris)).data.myTaskIds,[]);
});
test('canonical assignments show only the actor’s tasks and required hierarchy',async()=>{
 owned=await create({name:'Chris delivery',assigneeId:chris.data.user.id,owner:'Misleading text'});assert.equal(owned.owner,'Chris');
 other=await create({name:'Taylor delivery',assigneeId:taylor.data.user.id});await create({name:'Private delivery',projectId:privateProject.id,assigneeId:outsider.data.user.id});
 const mine=await req('my-work','GET',undefined,chris);assert.equal(mine.status,200);assert.deepEqual(taskIds(mine),[owned.id]);assert.deepEqual(mine.data.projects.map(p=>p.id),[project.id]);assert.deepEqual(mine.data.programs.map(p=>p.id),[program.id]);assert.deepEqual(mine.data.portfolios.map(p=>p.id),[portfolio.id]);
 assert.deepEqual((await req('workspace','GET',undefined,chris)).data.myTaskIds,[owned.id]);assert.deepEqual(taskIds(await req('my-work','GET',undefined,taylor)),[other.id]);assert.deepEqual(taskIds(await req('my-work')),[]);
});
test('assignee directory and write validation respect project access and role boundaries',async()=>{
 const people=await req('projects/'+project.id+'/assignees','GET',undefined,chris);assert.equal(people.status,200);assert.ok(people.data.users.some(u=>u.id===chris.data.user.id));assert.ok(!people.data.users.some(u=>u.id===outsider.data.user.id));assert.ok(people.data.users.every(u=>Object.keys(u).sort().join(',')==='email,id,name'));
 assert.equal((await req('projects/'+privateProject.id+'/assignees','GET',undefined,chris)).status,404);
 for(const assigneeId of [outsider.data.user.id,'missing',{},null])assert.equal((await req('tasks','POST',{name:'Invalid assignment',projectId:project.id,status:'To do',assigneeId})).status,400);
 assert.equal((await req('tasks/'+owned.id,'PATCH',{revision:owned.revision,assigneeId:chris.data.user.id},outsider)).status,404);
});
test('legacy unique names and email owners are recognized without rewriting records',async()=>{
 legacy=seedLegacy({id:'legacy-name',name:'Legacy work',owner:'  cHrIs  ',projectId:project.id,status:'To do',revision:1});
 emailLegacy=seedLegacy({id:'legacy-email',name:'Email work',owner:' CHRIS@EXAMPLE.TEST ',projectId:project.id,status:'Done',revision:1});
 assert.deepEqual(taskIds(await req('my-work','GET',undefined,chris)),[owned.id,legacy.id,emailLegacy.id].sort());assert.deepEqual((await req('tasks/'+legacy.id)).data,legacy);
});
test('duplicate display names never receive each other’s tasks; explicit account and email assignments still work',async()=>{
 twin=await invite('Chris','other-chris@example.test','contributor',[project.id]);
 assert.deepEqual(taskIds(await req('my-work','GET',undefined,chris)),[owned.id,emailLegacy.id].sort());assert.deepEqual(taskIds(await req('my-work','GET',undefined,twin)),[]);
 const assigned=await create({name:'Twin delivery',assigneeId:twin.data.user.id});assert.deepEqual(taskIds(await req('my-work','GET',undefined,twin)),[assigned.id]);
 assert.equal((await req('my-work','GET',undefined,chris)).data.tasks.some(t=>t.id===assigned.id),false);
});
test('reassignment updates both users, survives restart and never grants project membership',async()=>{
 const updated=await req('tasks/'+owned.id,'PATCH',{revision:owned.revision,assigneeId:taylor.data.user.id});assert.equal(updated.status,200);owned=updated.data;
 assert.equal((await req('my-work','GET',undefined,chris)).data.tasks.some(t=>t.id===owned.id),false);assert.ok((await req('my-work','GET',undefined,taylor)).data.tasks.some(t=>t.id===owned.id));
 const mine=(await req('my-work','GET',undefined,taylor)).data;await stop();await start();assert.deepEqual((await req('my-work','GET',undefined,taylor)).data,mine);
 assert.equal((await req('tasks/'+owned.id,'PATCH',{revision:owned.revision,projectId:privateProject.id})).status,400);
});
test('revoking project access removes work and assignee choices immediately',async()=>{
 const accounts=(await req('admin/users')).data.users,user=accounts.find(u=>u.id===taylor.data.user.id);const update=await req('admin/users/'+user.id,'PATCH',{revision:user.revision,projectIds:[]});assert.equal(update.status,200);
 assert.equal((await req('my-work','GET',undefined,taylor)).status,401);
 const login=await req('auth/login','POST',{email:'taylor@example.test',password},null);assert.equal(login.status,200);assert.deepEqual(taskIds(await req('my-work','GET',undefined,login)),[]);
 assert.equal((await req('projects/'+project.id+'/assignees')).data.users.some(u=>u.id===user.id),false);
 assert.equal((await req('tasks/'+owned.id,'PATCH',{revision:owned.revision,assigneeId:user.id})).status,400);
});
