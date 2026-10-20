import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hash, ProvisionError } from './provision.mjs';

// The HTTP server has already created the schema. No shared password is ever generated.
export function ensureFirstAdmin(databaseFile, manifest) {
  const db = new DatabaseSync(databaseFile);
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    const marker = db.prepare("SELECT data FROM records WHERE kind='meta' AND id='customer-provisioning'").get();
    if (marker) {
      const saved = JSON.parse(marker.data);
      if (saved.requestId !== manifest.requestId || saved.fingerprint !== manifest.fingerprint) throw new ProvisionError('DATABASE_CONFLICT','Database belongs to a different provisioning request');
      const user=db.prepare('SELECT * FROM users WHERE id=?').get(saved.adminId);
      if (!user || user.email!==manifest.request.adminEmail || user.role!=='admin' || !['active','invited'].includes(user.status)) throw new ProvisionError('ADMIN_CHANGED','Initial administrator has changed. Provisioning will not reset customer access');
      const invite=manifest.activationToken&&db.prepare('SELECT expires_at FROM invitations WHERE token_hash=? AND user_id=?').get(hash(manifest.activationToken),user.id);
      const customer=db.prepare('SELECT instance_id FROM customer WHERE id=1').get();
      db.exec('COMMIT');return {instanceId:customer.instance_id,state:user.status,tokenMatches:!!invite&&invite.expires_at>Date.now()};
    }
    if (db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind!='meta'").get().n || db.prepare('SELECT COUNT(*) AS n FROM users').get().n || db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n) throw new ProvisionError('DATABASE_NOT_EMPTY','Refusing to provision a database containing customer records, accounts, audit history or sample data');
    if (!manifest.activationToken || manifest.expiresAt<=Date.now()) throw new ProvisionError('ACTIVATION_EXPIRED','First-admin token expired before initialization; operator recovery is required');
    const id=randomUUID(),now=new Date().toISOString();
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,1,?)').run(id,manifest.request.adminEmail,manifest.request.adminName,'admin','invited',null,now);
    db.prepare('UPDATE customer SET name=?,setup_hash=? WHERE id=1').run(manifest.request.customerName,'');
    db.prepare('INSERT INTO invitations VALUES(?,?,?,?)').run(hash(manifest.activationToken),id,'invite',manifest.expiresAt);
    db.prepare('INSERT INTO records VALUES(?,?,?)').run('customer-provisioning','meta',JSON.stringify({requestId:manifest.requestId,fingerprint:manifest.fingerprint,adminId:id}));
    db.prepare('INSERT INTO audit_events(actor_id,action,object_id,details,created_at) VALUES(NULL,?,?,?,?)').run('operator.customer_provisioned',id,JSON.stringify({requestId:manifest.requestId,customerName:manifest.request.customerName}),now);
    const customer=db.prepare('SELECT instance_id FROM customer WHERE id=1').get();
    db.exec('COMMIT');return {instanceId:customer.instance_id,state:'invited',tokenMatches:true};
  } catch(e) {try{db.exec('ROLLBACK');}catch{}throw e;} finally {db.close();}
}
