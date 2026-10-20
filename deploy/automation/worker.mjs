import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest } from './provision.mjs';
export async function cloudRequest(url,key,body) {
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Worker queue URL must use HTTPS without credentials or a fragment');
 const response=await fetch(u,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','X-Pathtoo-Worker-Key':key},body:JSON.stringify(body)});
 if(!response.ok)throw Error('Queue request was not accepted; check workflow activation and its Header Auth credential');
 const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>65536)throw Error('Queue response too large');chunks.push(chunk);}
 const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(result.ok!==true)throw Error('Queue returned an unsuccessful response');return result;
}
export async function workerOnce({queue,run,pending}) {
 let completion=await pending.load();
 if(!completion) {
  const response=await queue({operation:'claim'});
  if(!response.job)return {idle:true};
  if(!Number.isInteger(response.queueRowId)||response.queueRowId<1)throw Error('Queue returned an invalid row ID');
  const requestId=response.job.requestId;
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(requestId||''))throw Error('Queue returned an invalid requestId');
  let request,result;
  try {request=validateRequest(response.job);result=await run(request);} catch(e) {if(e.code==='BUSY')return {busy:true};result={status:'error',requestId,code:'EXECUTION_FAILED',message:'The Pi could not complete provisioning. Operator review is required; retry the same requestId after fixing the cause.'};}
  if(!result||!['ready','error'].includes(result.status))throw Error('Provisioning returned an unsupported response');
  result.requestId=requestId;
  completion={operation:'complete',requestId,queueRowId:response.queueRowId,result};
  // Never lose a successful one-time link if n8n temporarily becomes unavailable.
  await pending.save(completion);
 }
 if(completion.result.status==='ready'&&completion.result.activationUrl&&Date.parse(completion.result.activationExpiresAt)<=Date.now()){completion.result.activationUrl=null;completion.result.activationExpiresAt=null;completion.result.requiresAdminLinkRecovery=true;await pending.save(completion);}
 const ack=await queue(completion);
 if(ack.requestId!==completion.requestId)throw Error('Queue did not acknowledge this request');
 await pending.clear();return {completed:true,requestId:completion.requestId,status:completion.result.status};
}
export async function runWorker() {
 const {PMO_QUEUE_URL:url,PMO_WORKER_KEY:key,PMO_WORKER_ID:workerId}=process.env;
 if(!url||url.includes('YOUR-N8N-HOST')||!key||key.startsWith('REPLACE_')||key.length<32||!/^[a-z0-9_-]{3,64}$/.test(workerId||''))throw Error('Configure PMO_QUEUE_URL, a private PMO_WORKER_KEY (32+ characters), and PMO_WORKER_ID');
 const pollSeconds=Number(process.env.PMO_POLL_SECONDS||300);if(!Number.isInteger(pollSeconds)||pollSeconds<60||pollSeconds>3600)throw Error('PMO_POLL_SECONDS must be an integer from 60 to 3600');
 const directory='/var/lib/pathtoo-worker';mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'pending.json');
 const pending={load:async()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null,save:async value=>{writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600,flush:true});renameSync(file+'.tmp',file);},clear:async()=>{if(existsSync(file))unlinkSync(file);}};
 const queue=body=>cloudRequest(url,key,{...body,workerId});
 const runWithStdin=request=>new Promise((resolve,reject)=>{
  const child=execFile('/usr/bin/sudo',['-n','/usr/local/sbin/pathtoo-provision'],{timeout:600000,maxBuffer:65536},(e,stdout)=>{
   if(e?.code===75)return reject(Object.assign(Error('Provisioner busy'),{code:'BUSY'}));
   try{resolve(JSON.parse(stdout));}catch{reject(Error('Provisioner did not return JSON'));}
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
 });
 let stopping=false,wake;const stop=()=>{stopping=true;if(wake)wake();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 while(!stopping){
  let drain=false;
  try{const result=await workerOnce({queue,run:runWithStdin,pending});if(result.completed){drain=true;console.log(`Deployment result acknowledged: ${result.requestId} (${result.status})`);}}
  catch{console.error('Queue/provisioning communication failed; retained pending result will be retried. Check worker configuration and n8n availability.');}
  if(!stopping&&!drain)await new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},pollSeconds*1000);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runWorker().catch(()=>{console.error('Worker configuration/startup failed. Check the root-only worker environment settings.');process.exitCode=1;});
