import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../auth.js';
import { provisionCustomer, validateRequest, customerSlug, inventoryPorts, routeMatches } from '../deploy/automation/provision.mjs';
import { ensureFirstAdmin } from '../deploy/automation/bootstrap.mjs';

const request=(id='request_00000001',name='Acme Health')=>({requestId:id,customerName:name,adminName:'Jordan Admin',adminEmail:'jordan@example.test'});
class FakePi {
 constructor(){this.root=mkdtempSync(path.join(tmpdir(),'pathtoo-provision-test-'));this.manifests=new Map();this.dbs=new Map();this.installs=0;this.routes=0;this.config={TCP:{443:{HTTPS:true}},Web:{'test-pi.tail123.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:3000'}}}}};this.maxCustomers=10;this.appStart=3300;this.httpsStart=8443;this.portCount=30;this.adminCrash=false;}
 async load(id){return this.manifests.has(id)?structuredClone(this.manifests.get(id)):null;}
 async save(m){this.manifests.set(m.requestId,structuredClone(m));}
 async list(){return [...this.manifests.values()].map(m=>structuredClone(m));}
 async tailscaleStatus(){return {BackendState:'Running',Self:{DNSName:'test-pi.tail123.ts.net.'}};}
 async serveConfig(){return structuredClone(this.config);}
 async portFree(port){return port!==3300;}
 async assertNewPaths(service){if(this.dbs.has(service))throw Error('Existing folder');}
 async install(m){this.installs++;const dir=path.join(this.root,m.service);mkdirSync(dir,{recursive:true});const file=path.join(dir,'pmo.sqlite');this.dbs.set(m.service,file);const db=new DatabaseSync(file);db.exec('CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL)');const previous=process.env.PMO_ACCESS_TOKEN;process.env.PMO_ACCESS_TOKEN='provision-test-bootstrap-123';createAuth(db,{dataDir:dir,host:'127.0.0.1'});if(previous===undefined)delete process.env.PMO_ACCESS_TOKEN;else process.env.PMO_ACCESS_TOKEN=previous;if(this.sample)db.prepare('INSERT INTO records VALUES(?,?,?)').run('sample','projects',JSON.stringify({id:'sample',name:'Do not delete me'}));db.close();}
 async waitReady(){if(this.failReady)throw Object.assign(Error('Not ready'),{code:'APP_NOT_READY'});}
 async ensureAdmin(m){const r=ensureFirstAdmin(this.dbs.get(m.service),m);if(this.adminCrash){this.adminCrash=false;throw Error('Crash after account transaction');}return r;}
 async serve(m){this.routes++;this.config.TCP[String(m.httpsPort)]={HTTPS:true};this.config.Web[`${m.hostname}:${m.httpsPort}`]={Handlers:{'/':{Proxy:`http://127.0.0.1:${m.appPort}`}}};}
 async verify(){if(this.failVerify)throw Object.assign(Error('HTTPS not ready'),{code:'HTTPS_NOT_READY'});}
 db(m){return new DatabaseSync(this.dbs.get(m.service));}
 close(){rmSync(this.root,{recursive:true,force:true});}
}
const withPi=async fn=>{const pi=new FakePi();try{await fn(pi);}finally{pi.close();}};

test('request validation rejects commands, paths, extra fields and missing administrator information',()=>{
 for(const input of [null,{}, {...request(),requestId:'../../etc/passwd'}, {...request(),command:'reboot'}, {...request(),adminEmail:'bad'}, {...request(),customerName:'Bad\nName'}, {...request(),password:'not-accepted'}])assert.throws(()=>validateRequest(input),e=>e.code==='INVALID_REQUEST');
 const hostile=request('request_hostile',"Acme'; $(touch /tmp/pathtoo-injected) Health");const valid=validateRequest(hostile);assert.match(customerSlug(valid.customerName),/^[a-z][a-z0-9-]{0,19}$/);assert.ok(!customerSlug(valid.customerName).includes('$'));
 assert.equal(customerSlug('Acme Health'),customerSlug('ACME HEALTH'));assert.notEqual(customerSlug('Acme Health'),customerSlug('Acme Health!'));
});
test('a fresh customer has no sample or project data and gets a one-time first-admin invite',()=>withPi(async pi=>{
 const before=structuredClone(pi.config);const result=await provisionCustomer(request(),pi);assert.equal(result.status,'ready');assert.equal(result.sampleData,false);assert.equal(result.access,'tailscale-only');assert.match(result.portalUrl,/^https:\/\/test-pi\.tail123\.ts\.net:8443$/);assert.match(result.activationUrl,/#accept=[a-f0-9]{64}$/);
 const m=await pi.load(result.requestId),db=pi.db(m);assert.equal(db.prepare("SELECT COUNT(*) n FROM records WHERE kind!='meta'").get().n,0);const user=db.prepare('SELECT * FROM users').get();assert.equal(user.role,'admin');assert.equal(user.status,'invited');assert.equal(user.password_hash,null);assert.equal(user.email,'jordan@example.test');assert.equal(db.prepare('SELECT name,setup_hash FROM customer').get().name,'Acme Health');assert.equal(db.prepare('SELECT setup_hash FROM customer').get().setup_hash,'');assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);db.close();
 assert.deepEqual(pi.config.Web['test-pi.tail123.ts.net:443'],before.Web['test-pi.tail123.ts.net:443']);assert.equal(m.appPort,3301);
}));
test('retries reuse paths, ports, account and activation token rather than duplicating',()=>withPi(async pi=>{
 const first=await provisionCustomer(request(),pi),second=await provisionCustomer(request(),pi);assert.deepEqual(second,first);assert.equal(pi.installs,1);assert.equal(pi.routes,1);const db=pi.db(await pi.load(first.requestId));assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM invitations').get().n,1);db.close();
 await assert.rejects(provisionCustomer({...request(),adminEmail:'other@example.test'},pi),e=>e.code==='REQUEST_CONFLICT');
 await assert.rejects(provisionCustomer(request('different_request'),pi),e=>e.code==='CUSTOMER_EXISTS');
}));
test('two customer requests receive separate databases, instances and ports',()=>withPi(async pi=>{
 const a=await provisionCustomer(request(),pi),b=await provisionCustomer(request('request_second','Beta Care'),pi);assert.notEqual(a.service,b.service);assert.notEqual(a.portalUrl,b.portalUrl);assert.notEqual(a.activationUrl,b.activationUrl);
 const ma=await pi.load(a.requestId),mb=await pi.load(b.requestId);assert.notEqual(ma.appPort,mb.appPort);const da=pi.db(ma),db=pi.db(mb);assert.notEqual(da.prepare('SELECT instance_id FROM customer').get().instance_id,db.prepare('SELECT instance_id FROM customer').get().instance_id);assert.equal(db.prepare('SELECT COUNT(*) n FROM records WHERE kind!=?').get('meta').n,0);da.close();db.close();
}));
test('crashing after administrator creation can be resumed without replacing that account',()=>withPi(async pi=>{
 pi.adminCrash=true;await assert.rejects(provisionCustomer(request(),pi));const saved=await pi.load(request().requestId);const token=saved.activationToken;const retry=await provisionCustomer(request(),pi);assert.equal(retry.activationUrl,`${retry.portalUrl}/#accept=${token}`);assert.equal(pi.installs,1);const db=pi.db(saved);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);db.close();
}));
test('sample/customer records cause a safe refusal rather than being removed',()=>withPi(async pi=>{
 pi.sample=true;await assert.rejects(provisionCustomer(request(),pi),e=>e.code==='DATABASE_NOT_EMPTY');assert.equal(pi.routes,0);const db=pi.db(await pi.load(request().requestId));assert.equal(db.prepare("SELECT COUNT(*) n FROM records WHERE kind='projects'").get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);db.close();
}));
test('HTTPS failure is not reported as success; retry preserves the prepared instance',()=>withPi(async pi=>{
 pi.failVerify=true;await assert.rejects(provisionCustomer(request(),pi),e=>e.code==='HTTPS_NOT_READY');const failed=await pi.load(request().requestId);assert.notEqual(failed.stage,'ready');pi.failVerify=false;const result=await provisionCustomer(request(),pi);assert.equal(result.status,'ready');assert.equal(pi.installs,1);assert.equal(pi.routes,1);
}));
test('public or conflicting existing routes are never overwritten',()=>withPi(async pi=>{
 const result=await provisionCustomer(request(),pi);const saved=await pi.load(result.requestId);pi.config.AllowFunnel={[`${saved.hostname}:${saved.httpsPort}`]:true};
 await assert.rejects(provisionCustomer(request(),pi),e=>e.code==='PUBLIC_ROUTE');assert.equal(pi.routes,1);
 delete pi.config.AllowFunnel;pi.config.Web[`${saved.hostname}:${saved.httpsPort}`].Handlers['/'].Proxy='http://127.0.0.1:9999';await assert.rejects(provisionCustomer(request(),pi),e=>e.code==='ROUTE_CONFLICT');assert.equal(pi.routes,1);
}));
test('active administrator retries return the portal but never generate a new takeover link',()=>withPi(async pi=>{
 const first=await provisionCustomer(request(),pi);const db=pi.db(await pi.load(first.requestId));db.prepare("UPDATE users SET status='active',password_hash='existing-hash'").run();db.prepare('DELETE FROM invitations').run();db.close();
 const result=await provisionCustomer(request(),pi);assert.equal(result.adminStatus,'active');assert.equal(result.activationUrl,null);assert.equal((await pi.load(first.requestId)).activationToken,undefined);const check=pi.db(await pi.load(first.requestId));assert.equal(check.prepare('SELECT password_hash FROM users').get().password_hash,'existing-hash');check.close();
}));
test('expired activation is flagged for operator recovery rather than silently resetting an admin',()=>withPi(async pi=>{
 const first=await provisionCustomer(request(),pi);const m=await pi.load(first.requestId);m.expiresAt=Date.now()-1;await pi.save(m);const result=await provisionCustomer(request(),pi);assert.equal(result.activationUrl,null);assert.equal(result.requiresAdminLinkRecovery,true);
}));
test('capacity and VPN prerequisites stop provisioning before installation',()=>withPi(async pi=>{
 pi.maxCustomers=1;await provisionCustomer(request(),pi);await assert.rejects(provisionCustomer(request('request_beta','Beta'),pi),e=>e.code==='CAPACITY_LIMIT');assert.equal(pi.installs,1);
 pi.tailscaleStatus=async()=>({BackendState:'Stopped'});await assert.rejects(provisionCustomer(request('request_gamma','Gamma'),pi),e=>e.code==='TAILSCALE_NOT_READY');assert.equal(pi.installs,1);
}));
test('Tailscale inventory includes foreground routes, services and Funnel endpoints',()=>{
 assert.deepEqual([...inventoryPorts({TCP:{443:{}},Web:{'h:8443':{}},AllowFunnel:{'h:10000':true},Foreground:{f:{TCP:{8000:{}}}},Services:{s:{TCP:{9000:{}}}}})].sort((a,b)=>a-b),[443,8000,8443,9000,10000]);assert.equal(routeMatches({},'host',8443,3300),false);
});

test('a provisioned administrator can activate in the real server and sees a completely empty workspace',async()=>{
 const {spawn}=await import('node:child_process');const {createServer}=await import('node:net');
 const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const pi=new FakePi();pi.appStart=port;pi.portCount=1;let child;
 try {
  const result=await provisionCustomer(request('http_test_request','Fresh Customer'),pi);const manifest=await pi.load(result.requestId);
  const directory=path.dirname(pi.dbs.get(manifest.service));
  child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',SEED_DEMO:'false'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('listening')){clearTimeout(timeout);resolve();}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server failed'));});});
  const base=`http://127.0.0.1:${port}/api/`;
  assert.equal((await fetch(base+'auth/status').then(r=>r.json())).setupRequired,false);
  assert.equal((await fetch(base+'workspace')).status,401);
  const token=new URL(result.activationUrl).hash.split('=')[1];
  const response=await fetch(base+'auth/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:'fresh-customer-long-passphrase'})});assert.equal(response.status,200);const auth=await response.json();assert.equal(auth.user.role,'admin');assert.equal(auth.organization.name,'Fresh Customer');const cookie=response.headers.get('set-cookie').split(';')[0];
  const workspace=await fetch(base+'workspace',{headers:{Cookie:cookie}}).then(r=>r.json());for(const kind of ['projects','tasks','raid','workstreams'])assert.deepEqual(workspace[kind],[]);
  const create=await fetch(base+'admin/users',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':auth.csrf},body:JSON.stringify({name:'New Colleague',email:'colleague@example.test',role:'viewer',projectIds:[]})});assert.equal(create.status,201);
  const retry=await provisionCustomer(request('http_test_request','Fresh Customer'),pi);assert.equal(retry.activationUrl,null);assert.equal(retry.adminStatus,'active');
  assert.equal((await fetch(base+'auth/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:'another-long-passphrase'})})).status,400);
 }finally{if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});pi.close();}
});

test('operator recovery can renew an expired first-admin invitation without creating another account',()=>withPi(async pi=>{
 const {spawn}=await import('node:child_process');const {readFileSync,statSync}=await import('node:fs');const {hash}=await import('../deploy/automation/provision.mjs');
 const first=await provisionCustomer(request(),pi),m=await pi.load(first.requestId),directory=path.dirname(pi.dbs.get(m.service));
 const old=pi.db(m);old.prepare('UPDATE invitations SET expires_at=0').run();old.close();
 const child=spawn(process.execPath,['manage.js','reset-admin',request().adminEmail],{env:{...process.env,DATA_DIR:directory,PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);assert.equal(await new Promise(resolve=>child.once('exit',resolve)),0);
 const filename=output.trim().split('private file: ')[1];assert.equal(statSync(filename).mode&0o777,0o600);const token=readFileSync(filename,'utf8').match(/accept=([a-f0-9]{64})/)[1];assert.ok(!output.includes(token));
 const db=pi.db(m);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);const invite=db.prepare('SELECT * FROM invitations').get();assert.equal(invite.token_hash,hash(token));assert.equal(invite.purpose,'invite');assert.ok(invite.expires_at-Date.now()>47*3600000);db.close();
 const retry=await provisionCustomer(request(),pi);assert.equal(retry.activationUrl,null);assert.equal(retry.requiresAdminLinkRecovery,true);
}));
