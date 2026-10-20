import { provisionCustomer } from './provision.mjs';
import { createPiPlatform } from './pi-platform.mjs';
// Fixed command, bounded JSON on stdin. No shell expressions, paths, ports, passwords or commands are accepted.
try {
 if(process.argv.length!==2)throw Object.assign(Error('Pass customer JSON through stdin; command-line flags are not accepted'),{code:'INVALID_REQUEST'});
 let body='';for await(const chunk of process.stdin){body+=chunk;if(Buffer.byteLength(body)>4096)throw Object.assign(Error('Request exceeds 4096 bytes'),{code:'INVALID_REQUEST'});}
 const result=await provisionCustomer(JSON.parse(body),createPiPlatform());
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(e){process.stdout.write(JSON.stringify({status:'error',code:e.code||'DEPLOYMENT_FAILED',message:e.code?e.message:e instanceof SyntaxError?'Invalid request JSON':'Deployment failed; ask the Pi operator to inspect the provisioning installation'})+'\n');process.exitCode=1;}
