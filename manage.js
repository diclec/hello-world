// Local operator recovery. Run as the service account, never expose as an HTTP endpoint.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const dataDir=process.env.DATA_DIR||path.join(import.meta.dirname,'.data');
const [command,email]=process.argv.slice(2);
if(command!=='reset-admin'||!email){console.error('Usage: DATA_DIR=/path/to/data node manage.js reset-admin admin@example.com');process.exit(1);}
const db=new DatabaseSync(path.join(dataDir,'pmo.sqlite'),{open:true});
const user=db.prepare("SELECT id FROM users WHERE email=? AND role='admin' AND status='active'").get(email.trim().toLowerCase());
if(!user){console.error('No active administrator with that email. No changes made.');db.close();process.exit(1);}
const token=randomBytes(32).toString('hex'),file=path.join(dataDir,`admin-recovery-${Date.now()}-${randomBytes(4).toString('hex')}.txt`);
const origin=process.env.PUBLIC_ORIGIN||'';
// Create the private file before changing the account; never print the link or token.
writeFileSync(file,`${origin}/#accept=${token}\nExpires in 1 hour. Share only with the account owner.\n`,{flag:'wx',mode:0o600});
db.exec('BEGIN IMMEDIATE');
try{
 db.prepare('DELETE FROM invitations WHERE user_id=?').run(user.id);
 db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
 db.prepare('INSERT INTO invitations VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.id,'reset',Date.now()+3600000);
 db.prepare('UPDATE users SET revision=revision+1 WHERE id=?').run(user.id);
 db.prepare('INSERT INTO audit_events(actor_id,action,object_id,details,created_at) VALUES(NULL,?,?,?,?)').run('operator.admin_recovery',user.id,'{}',new Date().toISOString());
 db.exec('COMMIT');
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
console.log('One-time recovery link written to private file: '+file);
