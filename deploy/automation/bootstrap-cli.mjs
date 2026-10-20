import { ensureFirstAdmin } from './bootstrap.mjs';
let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>16384)throw Error('Input too large');}
try{const result=ensureFirstAdmin(process.argv[2],JSON.parse(text));process.stdout.write(JSON.stringify(result));}
catch(e){process.stderr.write(JSON.stringify({code:e.code||'BOOTSTRAP_FAILED',message:e.code?e.message:'Customer administrator initialization failed'}));process.exitCode=1;}
