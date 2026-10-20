import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProvisionError } from './provision.mjs';

const release=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stateDir='/var/lib/pathtoo-provision';
const node='/opt/pathtoo-node/bin/node';
function trusted(file, directory=false) {
 const stat=lstatSync(file);if(stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)|| (directory?!stat.isDirectory():!stat.isFile()))throw new ProvisionError('UNTRUSTED_INSTALLATION','Provisioner files must be root-owned and not writable by other users');
}
export function createPiPlatform() {
 if(process.getuid?.()!==0)throw new ProvisionError('ROOT_REQUIRED','Run the installed provisioning wrapper through sudo');
 for(const dir of ['/opt/pathtoo-provisioner',release,stateDir])trusted(dir,true);
 trusted('/etc/pathtoo-provisioner.json');
 const config=JSON.parse(readFileSync('/etc/pathtoo-provisioner.json','utf8'));
 for(const key of ['maxCustomers','appStart','httpsStart','portCount'])if(!Number.isInteger(config[key]))throw new ProvisionError('CONFIG_INVALID','Provisioner settings must contain integer limits and port ranges');
 if(config.maxCustomers<1||config.maxCustomers>20||config.portCount<1||config.portCount>100||config.appStart<1024||config.httpsStart<1024||Math.max(config.appStart,config.httpsStart)+config.portCount>65536)throw new ProvisionError('CONFIG_INVALID','Unsafe provisioning limits');
 if(config.appStart<config.httpsStart+config.portCount&&config.httpsStart<config.appStart+config.portCount)throw new ProvisionError('CONFIG_INVALID','Application and HTTPS port ranges must not overlap');
 const requests=path.join(stateDir,'requests');mkdirSync(requests,{recursive:true,mode:0o700});trusted(requests,true);
 const filename=id=>path.join(requests,id+'.json');
 function run(command,args=[],options={}) {
  try{return execFileSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,stdio:['pipe','pipe','pipe'],...options});}
  catch(e){throw new ProvisionError('COMMAND_FAILED',`${path.basename(command)} failed. Review the Pi provisioner logs and prerequisites; no unrelated customer was modified.`);}
 }
 const json=(command,args)=>{try{return JSON.parse(run(command,args));}catch(e){if(e.code)throw e;throw new ProvisionError('COMMAND_RESPONSE','Command did not return supported JSON');}};
 const platform={...config,
  load:async id=>{const f=filename(id);if(!existsSync(f))return null;trusted(f);return JSON.parse(readFileSync(f,'utf8'));},
  list:async()=>readdirSync(requests).filter(f=>f.endsWith('.json')).map(f=>{const file=path.join(requests,f);trusted(file);return JSON.parse(readFileSync(file,'utf8'));}),
  save:async manifest=>{const file=filename(manifest.requestId),tmp=file+'.tmp';if(existsSync(tmp)){trusted(tmp);unlinkSync(tmp);}writeFileSync(tmp,JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});renameSync(tmp,file);},
  tailscaleStatus:async()=>json('/usr/bin/tailscale',['status','--json']),
  serveConfig:async()=>json('/usr/bin/tailscale',['serve','status','--json']),
  portFree:port=>new Promise(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));}),
  assertNewPaths:async service=>{
   for(const p of ['/opt/'+service,'/var/lib/'+service,'/etc/'+service+'.env','/etc/systemd/system/'+service+'.service'])if(existsSync(p))throw new ProvisionError('PATH_EXISTS','Customer installation paths already exist without a matching request; refusing to overwrite them');
   try{execFileSync('/usr/bin/id',[service],{stdio:'ignore'});throw new ProvisionError('ACCOUNT_EXISTS','Customer service account already exists');}catch(e){if(e.code==='ACCOUNT_EXISTS')throw e;}
  },
  install:async manifest=>{
   // A private per-request log is available to the operator; stdout remains machine-readable.
   const log=path.join(requests,manifest.requestId+'.install.log');
   try{const output=execFileSync('/bin/bash',[path.join(release,'deploy/install-pi.sh'),manifest.slug,manifest.portalUrl,String(manifest.appPort)],{encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8'}});writeFileSync(log,output,{mode:0o600});}
   catch(e){writeFileSync(log,String(e.stdout||'')+String(e.stderr||''),{mode:0o600});throw new ProvisionError('INSTALL_FAILED','Customer installation failed. The Pi operator can inspect the private request install log, fix the prerequisite, and retry the same requestId');}
  },
  waitReady:async manifest=>{
   for(let i=0;i<20;i++){
    try{const response=await fetch(`http://127.0.0.1:${manifest.appPort}/api/auth/status`,{signal:AbortSignal.timeout(3000)});const body=await response.json();if(response.ok&&typeof body.setupRequired==='boolean'&&body.instanceId)return; }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
   }throw new ProvisionError('APP_NOT_READY','Customer application did not become ready');
  },
  ensureAdmin:async manifest=>{
   const database=path.join('/var/lib',manifest.service,'pmo.sqlite');
   let result;
   try{result=JSON.parse(execFileSync('/usr/sbin/runuser',['-u',manifest.service,'--',node,path.join(release,'deploy/automation/bootstrap-cli.mjs'),database],{input:JSON.stringify(manifest),encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}));}
   catch(e){let detail;try{detail=JSON.parse(String(e.stderr));}catch{}throw new ProvisionError(detail?.code||'BOOTSTRAP_FAILED',detail?.message||'Customer administrator initialization failed');}
   return result;
  },
  serve:async manifest=>{run('/usr/bin/tailscale',['serve','--bg','--https='+manifest.httpsPort,`http://127.0.0.1:${manifest.appPort}`]);},
  verify:async manifest=>{
   for(const base of [`http://127.0.0.1:${manifest.appPort}`,manifest.portalUrl]) {
    let response,body;try{response=await fetch(base+'/api/auth/status',{signal:AbortSignal.timeout(15000)});body=await response.json();}catch{throw new ProvisionError('HTTPS_NOT_READY','Customer HTTPS/readiness request failed. Check Tailscale HTTPS, DNS and certificates on the Pi; retry the same request after fixing them');}
    if(!response.ok||body.instanceId!==manifest.instanceId||body.setupRequired!==false)throw new ProvisionError('INSTANCE_MISMATCH','Customer URL did not resolve to its own initialized application');
    const denied=await fetch(base+'/api/workspace',{signal:AbortSignal.timeout(10000)});if(denied.status!==401)throw new ProvisionError('ACCESS_CHECK_FAILED','Workspace was not protected by account authentication');
    const page=await fetch(base+'/',{signal:AbortSignal.timeout(10000)});if(!page.ok||!(await page.text()).includes('/identity.js'))throw new ProvisionError('PAGE_NOT_READY','Customer sign-in page was not served');
   }
   if(run('/usr/bin/systemctl',['is-active',manifest.service]).trim()!=='active')throw new ProvisionError('SERVICE_INACTIVE','Customer systemd service is not active');
  },
 };
 return platform;
}
