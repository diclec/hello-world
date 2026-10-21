import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const directory=mkdtempSync(path.join(tmpdir(),'pathtoo-hierarchy-'));
let port,child,admin,manager,viewer,contributor,p1,p2,g1,g2,project,hiddenProject;
const password='hierarchy-test-passphrase';
async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',PMO_ACCESS_TOKEN:'hierarchy-bootstrap-code',SEED_DEMO:'false'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server stopped'));});});}
const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
async function req(route,method='GET',data,actor=admin){const r=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});const body=await r.json();return {status:r.status,data:body,cookie:r.headers.get('set-cookie')?.split(';')[0],csrf:body.csrf};}
async function invite(name,role,projectIds=[]){const r=await req('admin/users','POST',{name,email:name+'@example.test',role,projectIds});assert.equal(r.status,201);const a=await req('auth/accept','POST',{token:r.data.token,password},null);assert.equal(a.status,200);return a;}
const projectData=(name,portfolioId='',programId='')=>({name,status:'Draft',budget:100,forecast:110,currency:'USD',portfolioId,programId});
before(async()=>{port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});await start();admin=await req('auth/setup','POST',{setupToken:'hierarchy-bootstrap-code',organization:'Hierarchy customer',name:'Admin',email:'admin@example.test',password},null);assert.equal(admin.status,201);});
after(async()=>{await stop();rmSync(directory,{recursive:true,force:true});});
test('fresh customer has no default or sample portfolios, programs or projects',async()=>{const ws=(await req('workspace')).data;for(const key of ['portfolios','programs','projects','tasks','raid','workstreams'])assert.deepEqual(ws[key],[]);});
test('create multiple portfolios and programs with parent validation and audit records',async()=>{
 let r=await req('portfolios','POST',{name:'Clinical transformation',description:'Clinical outcomes',status:'Active'});assert.equal(r.status,201);p1=r.data;
 r=await req('portfolios','POST',{name:'Enterprise technology'});assert.equal(r.status,201);p2=r.data;
 r=await req('programs','POST',{name:'Connected care',portfolioId:p1.id});assert.equal(r.status,201);g1=r.data;
 r=await req('programs','POST',{name:'Cloud modernization',portfolioId:p2.id});assert.equal(r.status,201);g2=r.data;
 assert.equal((await req('programs','POST',{name:'Missing portfolio'})).status,404);
 assert.equal((await req('programs','POST',{name:'Invalid parent',portfolioId:g1.id})).status,404);
 assert.equal((await req('portfolios','POST',{name:'   '})).status,400);
 const events=(await req('admin/audit')).data.events;assert.ok(events.some(e=>e.action==='portfolios.created'));assert.ok(events.some(e=>e.action==='programs.created'));
});
test('projects can belong directly to a portfolio, optionally to its program, or remain unassigned',async()=>{
 let r=await req('projects','POST',projectData('Visible project',p1.id,g1.id));assert.equal(r.status,201);project=r.data;
 r=await req('projects','POST',projectData('Restricted project',p1.id,g1.id));assert.equal(r.status,201);hiddenProject=r.data;
 assert.equal((await req('projects','POST',projectData('Direct project',p2.id))).status,201);
 assert.equal((await req('projects','POST',projectData('Legacy style project'))).status,201);
 assert.equal((await req('projects','POST',projectData('Cross-portfolio mismatch',p1.id,g2.id))).status,400);
 assert.equal((await req('projects','POST',projectData('Orphan program','',g1.id))).status,400);
 assert.equal((await req('projects','POST',projectData('Bad parent','missing'))).status,404);
 assert.equal((await req('projects','POST',{...projectData('Bad type'),portfolioId:{id:p1.id}})).status,400);
});
test('viewers see only ancestors of assigned projects; portfolio access never exposes other project records',async()=>{
 viewer=await invite('viewer','viewer',[project.id]);contributor=await invite('contributor','contributor',[project.id]);manager=await invite('manager','manager',[project.id]);
 const ws=(await req('workspace','GET',undefined,viewer)).data;assert.deepEqual(ws.projects.map(p=>p.id),[project.id]);assert.deepEqual(ws.portfolios.map(p=>p.id),[p1.id]);assert.deepEqual(ws.programs.map(p=>p.id),[g1.id]);
 assert.equal((await req('projects/'+hiddenProject.id,'GET',undefined,viewer)).status,404);
 assert.equal((await req('portfolios/'+p2.id,'GET',undefined,viewer)).status,404);
 assert.equal((await req('programs/'+g2.id,'GET',undefined,viewer)).status,404);
 assert.equal((await req('portfolios','POST',{name:'Escalate'},viewer)).status,403);
 assert.equal((await req('programs','POST',{name:'Escalate',portfolioId:p1.id},contributor)).status,403);
 assert.equal((await req('portfolios/'+p1.id,'PATCH',{revision:p1.revision,name:'Unauthorized rename'},manager)).status,403);
 assert.equal((await req('projects','POST',projectData('Hidden placement',p2.id),manager)).status,404);
});
test('managers can create and edit their own empty portfolio/program without access to others',async()=>{
 const portfolio=await req('portfolios','POST',{name:'Manager portfolio'},manager);assert.equal(portfolio.status,201);
 const program=await req('programs','POST',{name:'Manager program',portfolioId:portfolio.data.id},manager);assert.equal(program.status,201);
 assert.ok((await req('workspace','GET',undefined,manager)).data.portfolios.some(p=>p.id===portfolio.data.id));
 const edit=await req('portfolios/'+portfolio.data.id,'PATCH',{revision:1,name:'Revised manager portfolio'},manager);assert.equal(edit.status,200);
 assert.equal((await req('portfolios/'+portfolio.data.id,'PATCH',{revision:1,name:'Stale'},manager)).status,409);
 assert.equal((await req('portfolios/'+portfolio.data.id,'GET',undefined,viewer)).status,404);
 const created=await req('projects','POST',projectData('Manager delivery',portfolio.data.id,program.data.id),manager);assert.equal(created.status,201);
 assert.ok((await req('workspace','GET',undefined,manager)).data.projects.some(p=>p.id===created.data.id));
});
test('linked program moves are blocked and project moves require consistent parent relationships',async()=>{
 assert.equal((await req('programs/'+g1.id,'PATCH',{revision:g1.revision,portfolioId:p2.id})).status,409);
 assert.equal((await req('projects/'+project.id,'PATCH',{revision:project.revision,portfolioId:p2.id})).status,400);
 const moved=await req('projects/'+project.id,'PATCH',{revision:project.revision,portfolioId:p2.id,programId:g2.id});assert.equal(moved.status,200);project=moved.data;
 const ws=(await req('workspace','GET',undefined,viewer)).data;assert.deepEqual(ws.projects.map(p=>p.id),[project.id]);assert.deepEqual(ws.portfolios.map(p=>p.id),[p2.id]);assert.deepEqual(ws.programs.map(p=>p.id),[g2.id]);assert.equal((await req('projects/'+hiddenProject.id,'GET',undefined,viewer)).status,404);
 const detached=await req('projects/'+project.id,'PATCH',{revision:project.revision,portfolioId:'',programId:''});assert.equal(detached.status,200);project=detached.data;
 const unassigned=(await req('workspace','GET',undefined,viewer)).data;assert.equal(unassigned.projects.length,1);assert.deepEqual(unassigned.portfolios,[]);assert.deepEqual(unassigned.programs,[]);
});
test('empty program can move portfolios; changes persist without re-seeding on restart',async()=>{
 const empty=(await req('programs','POST',{name:'Empty program',portfolioId:p1.id})).data;
 assert.equal((await req('programs/'+empty.id,'PATCH',{revision:1,portfolioId:p2.id})).status,200);
 assert.equal((await req('programs/'+empty.id,'PATCH',{revision:1,name:'Stale'})).status,409);
 const snapshot=(await req('workspace')).data;await stop();await start();const restored=(await req('workspace')).data;assert.deepEqual(restored,snapshot);
});

test('health history uses observed daily values, stays within project access, and refreshes today without duplicates',async()=>{
 const database=new DatabaseSync(path.join(directory,'pmo.sqlite'));
 const prior=new Date(Date.now()-86400000).toISOString().slice(0,10),expired=new Date(Date.now()-35*86400000).toISOString().slice(0,10);
 const put=database.prepare('INSERT OR REPLACE INTO health_snapshots VALUES(?,?,?)');put.run(project.id,prior,'On track');put.run(hiddenProject.id,prior,'At risk');put.run(project.id,expired,'At risk');database.close();
 const changed=await req('projects/'+project.id,'PATCH',{revision:project.revision,forecast:600});assert.equal(changed.status,200);project=changed.data;
 const ws=(await req('workspace','GET',undefined,viewer)).data;
 assert.ok(ws.healthHistory.some(r=>r.day===prior&&r.health==='On track'));
 assert.ok(ws.healthHistory.some(r=>r.day===new Date().toISOString().slice(0,10)&&r.health==='At risk'));
 assert.ok(ws.healthHistory.every(r=>r.projectId===project.id&&r.day!==expired));
 assert.deepEqual((await req('workspace','GET',undefined,viewer)).data.healthHistory,ws.healthHistory);
 const restored=await req('projects/'+project.id,'PATCH',{revision:project.revision,forecast:100});assert.equal(restored.status,200);project=restored.data;
 const refreshed=(await req('workspace','GET',undefined,viewer)).data.healthHistory;assert.equal(refreshed.filter(r=>r.day===new Date().toISOString().slice(0,10)).length,1);assert.equal(refreshed.find(r=>r.day===new Date().toISOString().slice(0,10)).health,'Unknown');
});

test('actuals and commitments validate, enforce project permissions, remain optional and persist',async()=>{
 let r=await req('projects/'+project.id,'PATCH',{revision:project.revision,actuals:'35.50',committedCosts:20});assert.equal(r.status,200);project=r.data;assert.equal(project.actuals,35.5);assert.equal(project.committedCosts,20);
 for(const data of [{actuals:-1},{actuals:{}},{actuals:[]},{actuals:true},{actuals:' '},{actuals:'Infinity'},{committedCosts:-2},{committedCosts:[]},{committedCosts:false}])assert.equal((await req('projects/'+project.id,'PATCH',{revision:project.revision,...data})).status,400);
 assert.equal((await req('projects/'+project.id,'PATCH',{revision:project.revision,actuals:0},contributor)).status,403);
 assert.equal((await req('projects/'+project.id,'PATCH',{revision:project.revision,committedCosts:0},viewer)).status,403);
 assert.equal((await req('projects/'+hiddenProject.id,'GET',undefined,viewer)).status,404);
 await stop();await start();r=await req('projects/'+project.id);assert.equal(r.data.actuals,35.5);assert.equal(r.data.committedCosts,20);assert.equal(r.data.revision,project.revision);
 r=await req('projects/'+project.id,'PATCH',{revision:project.revision,actuals:'',committedCosts:null});assert.equal(r.status,200);project=r.data;assert.equal(Object.hasOwn(project,'actuals'),false);assert.equal(Object.hasOwn(project,'committedCosts'),false);
});
