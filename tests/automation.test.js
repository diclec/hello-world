import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { workerOnce, cloudRequest } from '../deploy/automation/worker.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const root=new URL('../n8n/',import.meta.url);
const code=name=>readFileSync(new URL('code/'+name,root),'utf8');
async function snippet(name,input,nodes={},extra={}) {return new AsyncFunction('$input','$','$execution','$runIndex',code(name))({first:()=>({json:input})},name=>({first:()=>({json:nodes[name]})}),{id:'12345'},extra.runIndex||0);}
const request={requestId:'request_worker_01',customerName:'Customer',adminName:'Owner',adminEmail:'owner@example.test'};
const memory=()=>{let value;return {load:async()=>value,save:async v=>{value=structuredClone(v);},clear:async()=>{value=undefined;}};};

test('worker uses no public Pi listener and sends validated customer data to the provisioner',async()=>{
 let executed=0,ack;
 const result=await workerOnce({pending:memory(),queue:async body=>body.operation==='claim'?{ok:true,queueRowId:1,job:request}:(ack=body,{ok:true,requestId:request.requestId}),run:async data=>{assert.deepEqual(data,request);executed++;return {status:'ready',portalUrl:'https://pi.tail.ts.net:8443',activationUrl:'private-test-link'};}});
 assert.equal(executed,1);assert.equal(result.completed,true);assert.equal(ack.result.requestId,request.requestId);assert.equal(ack.result.activationUrl,'private-test-link');
});
test('callback failure retains the result and retry does not redeploy or lose the activation link',async()=>{
 const pending=memory();let runs=0,fail=true;
 const queue=async body=>{if(body.operation==='claim')return {ok:true,queueRowId:1,job:request};if(fail)throw Error('n8n temporarily down');return {ok:true,requestId:request.requestId};};
 const run=async()=>{runs++;return {status:'ready',activationUrl:'one-time-private-test-link'};};
 await assert.rejects(workerOnce({queue,run,pending}));assert.equal((await pending.load()).result.activationUrl,'one-time-private-test-link');fail=false;
 assert.equal((await workerOnce({queue,run,pending})).completed,true);assert.equal(runs,1);assert.equal(await pending.load(),undefined);
});
test('an occupied provisioner lock leaves the job retryable rather than returning false completion',async()=>{
 let completed=false;const r=await workerOnce({pending:memory(),queue:async body=>{if(body.operation==='complete')completed=true;return {ok:true,queueRowId:1,job:request};},run:async()=>{throw Object.assign(Error('busy'),{code:'BUSY'});}});assert.equal(r.busy,true);assert.equal(completed,false);
});
test('queue client refuses plaintext or embedded credentials before making a network request',async()=>{
 await assert.rejects(cloudRequest('http://example.test/webhook','private-key',{}));await assert.rejects(cloudRequest('https://user:password@example.test/webhook','private-key',{}));
});
test('the n8n tool asks only for missing basic details and never requests a password',async()=>{
 const r=await snippet('prepare-deployment.code',{customerName:'Acme'});assert.equal(r[0].json.response.status,'needs_input');assert.deepEqual(r[0].json.response.missing,['adminName','adminEmail']);assert.ok(!JSON.stringify(r).includes('password'));
 const v=(await snippet('prepare-deployment.code',{customerName:'Acme',adminName:'Owner',adminEmail:'OWNER@example.test'}))[0].json;assert.equal(v.valid,true);assert.equal(JSON.parse(v.payload).adminEmail,'owner@example.test');assert.match(v.requestId,/^[A-Za-z0-9_-]{8,80}$/);
});
test('n8n duplicate request handling preserves queued/completed jobs and rejects conflicting payloads',async()=>{
 const prepared={valid:true,requestId:request.requestId,workerId:'pi-ny-db1',payload:JSON.stringify(request)};
 const existing=(await snippet('check-existing.code',{id:1,...prepared,status:'done'},{'Prepare deployment':prepared}))[0].json;assert.equal(existing.exists,true);assert.equal(existing.conflict,false);
 const conflict=(await snippet('check-existing.code',{id:1,...prepared,payload:'different'},{'Prepare deployment':prepared}))[0].json;assert.equal(conflict.conflict,true);
 const answer=(await snippet('check-result.code',{id:1,payload:prepared.payload,workerId:prepared.workerId,status:'done',result:JSON.stringify({status:'ready',portalUrl:'https://pi.tail.ts.net:8443'})},{'Prepare deployment':prepared}))[0].json;assert.equal(answer.done,true);assert.equal(answer.response.status,'ready');
});
test('protected worker workflow accepts only private empty-customer results',async()=>{
 const result={status:'ready',requestId:request.requestId,portalUrl:'https://pi.tail.ts.net:8443',activationUrl:'https://pi.tail.ts.net:8443/#accept='+'a'.repeat(64),sampleData:false,access:'tailscale-only'};
 const input={body:{operation:'complete',queueRowId:1,workerId:'pi-ny-db1',requestId:request.requestId,result}};assert.equal((await snippet('worker-request.code',input))[0].json.operation,'complete');
 await assert.rejects(snippet('worker-request.code',{body:{...input.body,result:{...result,sampleData:true}}}));await assert.rejects(snippet('worker-request.code',{body:{...input.body,result:{...result,activationUrl:'https://attacker.test'}}}));await assert.rejects(snippet('worker-request.code',{body:{operation:'execute',workerId:'pi-ny-db1'}}));
});
test('queue claim and callback are correlated with the intended worker and request',async()=>{
 const body={operation:'claim',workerId:'pi-ny-db1'};
 const row={id:1,workerId:body.workerId,status:'queued',requestId:request.requestId,payload:JSON.stringify(request)};
 const claimed=(await snippet('choose-job.code',row,{'Worker request':body}))[0].json;assert.deepEqual(claimed.job,request);
 await assert.rejects(snippet('choose-job.code',{...row,workerId:'another-worker'},{'Worker request':body}));
 const completed=(await snippet('check-completion.code',{...row,status:'done'},{'Worker request':{...body,queueRowId:1,requestId:request.requestId,result:{status:'ready'}}}))[0].json;assert.equal(completed.alreadyDone,true);
});
test('all workflow nodes have valid connections and code; queue has Header Auth and execution saving disabled',()=>{
 for(const file of readdirSync(root).filter(f=>f.endsWith('.json'))){const w=JSON.parse(readFileSync(new URL(file,root),'utf8'));const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.active,false);
 for(const [source,c]of Object.entries(w.connections)){assert.ok(names.has(source));for(const output of c.main)for(const target of output)assert.ok(names.has(target.node));}
 for(const n of w.nodes)if(n.type==='n8n-nodes-base.code')assert.doesNotThrow(()=>new AsyncFunction('$input','$','$execution','$runIndex',n.parameters.jsCode));
 if(file==='worker-queue.json'){const hook=w.nodes.find(n=>n.type==='n8n-nodes-base.webhook');assert.equal(hook.parameters.authentication,'headerAuth');assert.equal(hook.parameters.responseMode,'responseNode');}
 }
});

test('late callback delivery suppresses an activation link that expired during an n8n outage',async()=>{
 const pending=memory();await pending.save({operation:'complete',queueRowId:1,requestId:request.requestId,result:{status:'ready',activationUrl:'expired-private-link',activationExpiresAt:new Date(0).toISOString()}});let delivered;
 await workerOnce({pending,run:async()=>{throw Error('must not redeploy');},queue:async body=>{delivered=body;return {ok:true,requestId:request.requestId};}});
 assert.equal(delivered.result.activationUrl,null);assert.equal(delivered.result.requiresAdminLinkRecovery,true);
});
test('a conflicting queue row cannot return another customer’s successful result',async()=>{
 const prepared={requestId:request.requestId,payload:JSON.stringify(request),workerId:'pi-ny-db1'};
 const response=(await snippet('check-result.code',{id:1,payload:'another customer',workerId:'pi-ny-db1',status:'done',result:JSON.stringify({status:'ready',activationUrl:'must-not-return'})},{'Prepare deployment':prepared}))[0].json.response;
 assert.equal(response.code,'REQUEST_CONFLICT');assert.equal(response.activationUrl,undefined);
});
