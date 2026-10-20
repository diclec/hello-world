import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const [primaryPort,secondaryPort]=await Promise.all([freePort(),freePort()]);
const setupToken = 'test-bootstrap-token-123';
const password = 'a-long-test-passphrase-123';
const dir = mkdtempSync(path.join(tmpdir(),'pathtoo-test-'));
const secondDir = mkdtempSync(path.join(tmpdir(),'pathtoo-isolation-'));
let child, second, admin, viewer, contributor, manager, secondAdmin, project;
async function start(port=primaryPort,dataDir=dir,seed='true',extra={}) {
  const proc=spawn(process.execPath,['server.js'],{env:{...process.env,PUBLIC_ORIGIN:'',DATA_DIR:dataDir,PORT:String(port),PMO_ACCESS_TOKEN:setupToken,SEED_DEMO:seed,...extra},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{proc.kill();reject(Error('Server startup timed out'));},10000);let errors='';proc.stderr.on('data',d=>{errors+=d.toString();});proc.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timeout);resolve();}});proc.once('exit',()=>{clearTimeout(timeout);reject(Error('Startup failed: '+errors));});});return proc;
}
const stop=proc=>new Promise(resolve=>{if(!proc||proc.exitCode!==null)return resolve();proc.once('exit',resolve);proc.kill();});
async function req(route,method='GET',data,actor=admin,port=primaryPort,headers={}) {
 const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{}),...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})});
 const result=await response.json(); const set=response.headers.get('set-cookie');
 return {status:response.status,data:result,cookie:set?.split(';')[0],cookieHeader:set,csrf:result.csrf};
}
async function login(email,port=primaryPort){const r=await req('auth/login','POST',{email,password},null,port);assert.equal(r.status,200);return {...r,user:r.data.user};}
async function invite(name,role,projectIds=[]){const r=await req('admin/users','POST',{name,email:name+'@example.test',role,projectIds});assert.equal(r.status,201);const accepted=await req('auth/accept','POST',{token:r.data.token,password},null);assert.equal(accepted.status,200);return {...accepted,user:accepted.data.user};}
before(async()=>{child=await start();});
after(async()=>{await stop(child);await stop(second);rmSync(dir,{recursive:true,force:true});rmSync(secondDir,{recursive:true,force:true});});

test('bootstrap is protected; legacy bearer access is denied; setup is one-time and preserves data',async()=>{
 assert.equal((await req('workspace','GET',undefined,null)).status,401);
 assert.equal((await req('workspace','GET',undefined,null,primaryPort,{Authorization:'Bearer '+setupToken})).status,401);
 assert.equal((await req('auth/setup','POST',{setupToken:'wrong',name:'Owner',email:'owner@example.test',organization:'Customer A',password},null)).status,403);
 const r=await req('auth/setup','POST',{setupToken,name:'Owner',email:'owner@example.test',organization:'Customer A',password},null);assert.equal(r.status,201);admin=r;
 assert.match(r.cookieHeader,/HttpOnly/);assert.match(r.cookieHeader,/SameSite=Strict/);
 assert.equal((await req('auth/setup','POST',{setupToken,name:'Intruder',email:'intruder@example.test',organization:'Changed',password},null)).status,409);
 const ws=(await req('workspace')).data;assert.equal(ws.projects.length,6);assert.equal(ws.tasks.length,5);assert.equal(ws.projects.find(p=>p.id==='p4').health,'At risk');
 const me=(await req('auth/me')).data;assert.equal(me.organization.name,'Customer A');assert.equal(me.user.role,'admin');assert.equal(me.user.sessionHash,undefined);
});
test('authenticated writes require CSRF and same-origin requests',async()=>{
 const input={name:'Blocked',status:'Draft',budget:1,forecast:1};
 assert.equal((await req('projects','POST',input,admin,primaryPort,{'X-CSRF-Token':''})).status,403);
 assert.equal((await req('projects','POST',input,admin,primaryPort,{Origin:'https://attacker.example'})).status,403);
 assert.equal((await req('auth/login','POST',{email:'owner@example.test',password},null,primaryPort,{Origin:'https://attacker.example'})).status,403);
});
test('project records, revision conflicts and author audit persist across restarts',async()=>{
 let r=await req('projects','POST',{name:'User project',owner:'Owner',category:'Infrastructure',status:'Draft',budget:100,forecast:100,currency:'USD'});assert.equal(r.status,201);project=r.data;assert.ok(project.authorId);
 const w=(await req('workstreams','POST',{name:'Discovery',projectId:project.id})).data;
 r=await req('tasks','POST',{name:'Validate network',projectId:project.id,workstreamId:w.id,status:'To do'});assert.equal(r.status,201);const task=r.data;
 assert.equal((await req('tasks/'+task.id,'PATCH',{revision:task.revision,status:'Done'})).status,200);
 assert.equal((await req('tasks/'+task.id,'PATCH',{revision:task.revision,status:'Blocked'})).status,409);
 assert.equal((await req('tasks','POST',{name:'Cross project',projectId:'p1',workstreamId:w.id,status:'To do'})).status,400);
 await stop(child);child=await start();assert.equal((await req('workspace')).data.tasks.find(t=>t.id===task.id).status,'Done');
 const events=(await req('admin/audit')).data.events;assert.ok(events.some(e=>e.action==='tasks.updated'&&e.actor_id===project.authorId));
});
test('invitations are single use, role-aware and have no account access until accepted',async()=>{
 const r=await req('admin/users','POST',{name:'Pending',email:'pending@example.test',role:'viewer',projectIds:[]});assert.equal(r.status,201);
 assert.equal((await req('auth/login','POST',{email:'pending@example.test',password},null)).status,401);
 assert.equal((await req('auth/accept','POST',{token:r.data.token,password:'short'},null)).status,400);
 assert.equal((await req('auth/accept','POST',{token:r.data.token,password},null)).status,200);
 assert.equal((await req('auth/accept','POST',{token:r.data.token,password},null)).status,400);
 viewer=await invite('viewer','viewer',[project.id]);contributor=await invite('contributor','contributor',[project.id]);manager=await invite('manager','manager',[project.id]);
 const users=(await req('admin/users')).data.users;assert.ok(users.every(u=>u.password_hash===undefined));
});
test('project boundaries and role permissions apply to direct API requests',async()=>{
 const ws=(await req('workspace','GET',undefined,viewer)).data;assert.deepEqual(ws.projects.map(p=>p.id),[project.id]);assert.ok(ws.tasks.every(t=>t.projectId===project.id));assert.equal(ws.raid.length,0);
 assert.equal((await req('projects/p1','GET',undefined,viewer)).status,404);
 assert.equal((await req('tasks/t0','GET',undefined,contributor)).status,404);
 assert.equal((await req('tasks','POST',{name:'Forbidden',projectId:project.id,status:'To do'},viewer)).status,403);
 assert.equal((await req('projects/'+project.id,'PATCH',{...project,name:'Forbidden'},contributor)).status,403);
 assert.equal((await req('tasks','POST',{name:'Other project',projectId:'p1',status:'To do'},contributor)).status,404);
 const task=(await req('tasks','POST',{name:'Contribution',projectId:project.id,status:'To do'},contributor));assert.equal(task.status,201);
 assert.equal((await req('tasks/'+task.data.id,'PATCH',{revision:1,projectId:'p1'},contributor)).status,404);
 const created=await req('projects','POST',{name:'Managed project',status:'Draft',budget:100,forecast:100},manager);assert.equal(created.status,201);
 assert.ok((await req('workspace','GET',undefined,manager)).data.projects.some(p=>p.id===created.data.id));
 assert.equal((await req('admin/users','GET',undefined,manager)).status,403);
 assert.equal((await req('admin/users','POST',{name:'Escalate',email:'bad@example.test',role:'admin'},contributor)).status,403);
 assert.equal((await req('demo','DELETE',{},viewer)).status,403);
});
test('last administrator cannot be disabled or demoted',async()=>{
 const owner=(await req('admin/users')).data.users.find(u=>u.email==='owner@example.test');
 assert.equal((await req('admin/users/'+owner.id,'PATCH',{revision:owner.revision,role:'viewer'})).status,409);
 assert.equal((await req('admin/users/'+owner.id,'PATCH',{revision:owner.revision,status:'disabled'})).status,409);
});
test('role changes, disable and password reset immediately revoke sessions and links',async()=>{
 let user=(await req('admin/users')).data.users.find(u=>u.email==='viewer@example.test');
 assert.equal((await req('admin/users/'+user.id,'PATCH',{revision:user.revision,status:'disabled'})).status,200);
 assert.equal((await req('workspace','GET',undefined,viewer)).status,401);assert.equal((await req('auth/login','POST',{email:user.email,password},null)).status,401);
 user=(await req('admin/users')).data.users.find(u=>u.id===user.id);
 assert.equal((await req('admin/users/'+user.id,'PATCH',{revision:user.revision,status:'active'})).status,200);
 viewer=await login(user.email);
 user=(await req('admin/users')).data.users.find(u=>u.id===user.id);
 const reset=await req('admin/users/'+user.id+'/reset','POST',{revision:user.revision});assert.equal(reset.status,200);
 assert.equal((await req('workspace','GET',undefined,viewer)).status,401);
 user=(await req('admin/users')).data.users.find(u=>u.id===user.id);
 const replacement=await req('admin/users/'+user.id+'/reset','POST',{revision:user.revision});assert.equal(replacement.status,200);
 assert.equal((await req('auth/accept','POST',{token:reset.data.token,password},null)).status,400);
 assert.equal((await req('auth/accept','POST',{token:replacement.data.token,password},null)).status,200);
 assert.equal((await req('auth/accept','POST',{token:replacement.data.token,password},null)).status,400);
 viewer=await login(user.email);user=(await req('admin/users')).data.users.find(u=>u.id===user.id);
 assert.equal((await req('admin/users/'+user.id,'PATCH',{revision:user.revision,role:'contributor'})).status,200);
 assert.equal((await req('workspace','GET',undefined,viewer)).status,401);
 assert.equal((await req('admin/users/'+user.id,'PATCH',{revision:user.revision,name:'Stale'})).status,409);
});
test('new customers start empty and cannot share sessions, records, or invitation tokens',async()=>{
 second=await start(secondaryPort,secondDir,'false');const r=await req('auth/setup','POST',{setupToken,name:'Owner B',email:'owner@example.test',organization:'Customer B',password},null,secondaryPort);assert.equal(r.status,201);secondAdmin=r;assert.notEqual(admin.cookie.split('=')[0],r.cookie.split('=')[0]);
 assert.equal((await req('workspace','GET',undefined,secondAdmin,secondaryPort)).data.projects.length,0);
 assert.equal((await req('workspace','GET',undefined,admin,secondaryPort)).status,401);
 assert.equal((await req('projects/'+project.id,'GET',undefined,secondAdmin,secondaryPort)).status,404);
 const invite=await req('admin/users','POST',{name:'Boundary',email:'boundary@example.test',role:'viewer'});
 assert.equal((await req('auth/accept','POST',{token:invite.data.token,password},null,secondaryPort)).status,400);
 assert.notEqual((await req('auth/me')).data.organization.instance_id,(await req('auth/me','GET',undefined,secondAdmin,secondaryPort)).data.organization.instance_id);
});
test('HTTPS origin enforces secure cookies; expired invitations and sessions fail',async()=>{
 await stop(second);second=await start(secondaryPort,secondDir,'false',{PUBLIC_ORIGIN:'https://customer.example'});
 const logged=await req('auth/login','POST',{email:'owner@example.test',password},null,secondaryPort,{Origin:'https://customer.example'});assert.equal(logged.status,200);assert.match(logged.cookieHeader,/; Secure/);
 assert.equal((await req('auth/login','POST',{email:'owner@example.test',password},null,secondaryPort,{Origin:'https://wrong.example'})).status,403);
 const db=new DatabaseSync(secondDir+'/pmo.sqlite');db.prepare('UPDATE sessions SET seen_at=0').run();db.close();assert.equal((await req('workspace','GET',undefined,logged,secondaryPort)).status,401);
 const invite=await req('admin/users','POST',{name:'Expired',email:'expired@example.test',role:'viewer'});const d=new DatabaseSync(dir+'/pmo.sqlite');d.prepare('UPDATE invitations SET expires_at=0').run();d.close();assert.equal((await req('auth/accept','POST',{token:invite.data.token,password},null)).status,400);
});
test('password change rotates sessions; logout revokes the current session',async()=>{
 const old=await login('owner@example.test');const current=await login('owner@example.test');
 const changed=await req('auth/password','POST',{currentPassword:password,password:'a-different-long-passphrase'},current);assert.equal(changed.status,200);
 assert.equal((await req('workspace','GET',undefined,old)).status,401);assert.equal((await req('workspace','GET',undefined,current)).status,401);
 admin=changed;assert.equal((await req('auth/logout','POST',{},admin)).status,200);assert.equal((await req('workspace','GET',undefined,admin)).status,401);
 const signed=await req('auth/login','POST',{email:'owner@example.test',password:'a-different-long-passphrase'},null);assert.equal(signed.status,200);admin=signed;
});
test('demo removal preserves user records and health handles missing data',async()=>{
 assert.equal((await req('projects/'+project.id)).data.health,'Unknown');
 const r=await req('raid','POST',{name:'Overdue response',projectId:project.id,type:'Risk',status:'Open',severity:'High',due:'2020-01-01',probability:4,impact:5});assert.equal(r.status,201);
 assert.equal((await req('projects/'+project.id)).data.health,'Needs attention');
 assert.equal((await req('projects/'+project.id,'PATCH',{revision:project.revision,status:'Closed'})).status,400);
 assert.equal((await req('demo','DELETE',{})).status,200);await stop(child);child=await start();const ws=(await req('workspace')).data;assert.ok(ws.projects.every(p=>!p.demo));assert.ok(ws.projects.some(p=>p.id===project.id));
});
test('failed login attempts are rate-limited with a generic response',async()=>{
 for(let i=0;i<10;i++)assert.equal((await req('auth/login','POST',{email:'unknown@example.test',password:'bad'},null)).status,401);
 assert.equal((await req('auth/login','POST',{email:'unknown@example.test',password:'bad'},null)).status,429);
});

test('upgrading an existing single-owner database preserves exact project records',async()=>{
 await stop(second);const migrationDir=mkdtempSync(path.join(tmpdir(),'pathtoo-migration-'));
 try {
  const d=new DatabaseSync(migrationDir+'/pmo.sqlite');d.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL)');
  const legacy={id:'legacy-project',name:'Existing customer data',owner:'Original Owner',status:'Active',budget:500,forecast:500,currency:'USD',revision:9};
  d.prepare('INSERT INTO records VALUES(?,?,?)').run(legacy.id,'projects',JSON.stringify(legacy));d.prepare('INSERT INTO records VALUES(?,?,?)').run('initialized','meta',JSON.stringify({id:'initialized'}));d.close();
  second=await start(secondaryPort,migrationDir,'false');
  const r=await req('auth/setup','POST',{setupToken,name:'Migrated Owner',email:'migrated@example.test',organization:'Existing Customer',password},null,secondaryPort);assert.equal(r.status,201);
  const workspace=(await req('workspace','GET',undefined,r,secondaryPort)).data;assert.equal(workspace.projects.length,1);assert.equal(workspace.projects[0].revision,9);
  const verify=new DatabaseSync(migrationDir+'/pmo.sqlite');assert.deepEqual(JSON.parse(verify.prepare('SELECT data FROM records WHERE id=?').get(legacy.id).data),legacy);verify.close();
  assert.equal((await req('workspace','GET',undefined,null,secondaryPort,{Authorization:'Bearer '+setupToken})).status,401);
 } finally {await stop(second);second=null;rmSync(migrationDir,{recursive:true,force:true});}
});


test('local operator recovery issues a private one-time link and revokes admin sessions',async()=>{
 const proc=spawn(process.execPath,['manage.js','reset-admin','owner@example.test'],{env:{...process.env,DATA_DIR:dir,PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',d=>output+=d);const code=await new Promise(resolve=>proc.once('exit',resolve));assert.equal(code,0);
 const filename=output.trim().split('private file: ')[1];assert.ok(filename.startsWith(dir+'/admin-recovery-'));assert.equal(statSync(filename).mode&0o777,0o600);
 const token=readFileSync(filename,'utf8').match(/accept=([a-f0-9]{64})/)[1];assert.ok(!output.includes(token));
 assert.equal((await req('workspace','GET',undefined,admin)).status,401);
 const recovered=await req('auth/accept','POST',{token,password:'recovered-admin-passphrase'},null);assert.equal(recovered.status,200);assert.equal(recovered.data.user.role,'admin');admin=recovered;
 assert.equal((await req('auth/accept','POST',{token,password},null)).status,400);
 assert.ok((await req('admin/audit')).data.events.some(e=>e.action==='operator.admin_recovery'));
 const db=new DatabaseSync(dir+'/pmo.sqlite');const stored=db.prepare('SELECT password_hash FROM users WHERE email=?').get('owner@example.test').password_hash;assert.ok(!stored.includes('recovered-admin-passphrase'));db.close();
});
