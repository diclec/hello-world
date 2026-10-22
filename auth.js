import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const roles = ['admin', 'manager', 'contributor', 'viewer'];
const DAY = 86400000;
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function readJSON(req) {
  if (!req.pmoBody) req.pmoBody = parseJSON(req);
  return req.pmoBody;
}
async function parseJSON(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Send application/json');
  let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 50000) fail(413, 'Record too large'); }
  const value = JSON.parse(body || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object');
  return value;
}
const text = (s, max = 160) => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= max;
const normalizeEmail = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
function validateIdentity(input) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !text(input.name)) fail(400, 'Enter a name and valid email address');
  return { email, name: input.name.trim() };
}
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) fail(400, 'Use a password between 12 and 256 characters');
  const salt = secret(); const hash = await derive(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [salt, expected] = (encoded || `${'0'.repeat(64)}:${'0'.repeat(128)}`).split(':');
  const actual = await derive(typeof password === 'string' && password.length <= 256 ? password : '', salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return equal(actual.toString('hex'), expected);
}

export function createAuth(db, { dataDir, host }) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS customer (id INTEGER PRIMARY KEY CHECK(id=1), instance_id TEXT NOT NULL, name TEXT NOT NULL, setup_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','contributor','viewer')), status TEXT NOT NULL CHECK(status IN ('invited','active','disabled')), password_hash TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (user_id TEXT REFERENCES users(id), project_id TEXT NOT NULL, PRIMARY KEY(user_id,project_id));
    CREATE TABLE IF NOT EXISTS user_workstreams (user_id TEXT PRIMARY KEY REFERENCES users(id), workstream_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, object_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  const sql = (query, ...args) => db.prepare(query).run(...args);
  const one = (query, ...args) => db.prepare(query).get(...args);
  const many = (query, ...args) => db.prepare(query).all(...args);
  const configured = () => one('SELECT COUNT(*) AS n FROM users').n > 0;
  if (!one('SELECT id FROM customer WHERE id=1')) {
    let bootstrap = process.env.PMO_ACCESS_TOKEN;
    if (bootstrap && bootstrap.length < 16) throw new Error('PMO_ACCESS_TOKEN must contain at least 16 characters');
    if (!bootstrap) {
      if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Configure PMO_ACCESS_TOKEN before first startup');
      const file = path.join(dataDir, 'setup-token');
      if (!existsSync(file)) writeFileSync(file, secret(), { mode: 0o600, flag: 'wx' });
      bootstrap = readFileSync(file, 'utf8').trim();
    }
    sql('INSERT INTO customer VALUES(1,?,?,?)', randomUUID(), 'PathToo workspace', digest(bootstrap));
  }
  const cookieName = 'pmo_session_' + one('SELECT instance_id FROM customer WHERE id=1').instance_id.replaceAll('-', '');
  const origin = process.env.PUBLIC_ORIGIN;
  if (origin) {
    const u = new URL(origin);
    if (u.origin !== origin || (u.protocol !== 'https:' && !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');
  }
  function audit(actor, action, objectId = null, details = {}) {
    sql('INSERT INTO audit_events(actor_id,action,object_id,details,created_at) VALUES(?,?,?,?,?)', actor?.id || null, action, objectId, JSON.stringify(details), new Date().toISOString());
  }
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, revision: u.revision, createdAt: u.created_at, workstreamId: one('SELECT workstream_id FROM user_workstreams WHERE user_id=?',u.id)?.workstream_id||'', hasPassword: !!u.password_hash, projectIds: many('SELECT project_id FROM memberships WHERE user_id=?', u.id).map(m => m.project_id) });
  function context(req) {
    const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const session = one('SELECT * FROM sessions WHERE token_hash=?', digest(raw));
    if (!session) return null;
    const user = one('SELECT * FROM users WHERE id=?', session.user_id);
    if (Date.now() - session.created_at > DAY / 2 || Date.now() - session.seen_at > 3600000 || user?.status !== 'active') { sql('DELETE FROM sessions WHERE token_hash=?', session.token_hash); return null; }
    sql('UPDATE sessions SET seen_at=? WHERE token_hash=?', Date.now(), session.token_hash);
    return { ...publicUser(user), csrf: session.csrf, sessionHash: session.token_hash };
  }
  function cookie(req, res, token, clear = false) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') && !origin;
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 43200}${isLocal ? '' : '; Secure'}`);
  }
  function issueSession(req, res, user) {
    const token = secret(); const csrf = secret(); const now = Date.now();
    sql('DELETE FROM sessions WHERE created_at<? OR seen_at<?', now - DAY / 2, now - 3600000);
    sql('INSERT INTO sessions VALUES(?,?,?,?,?)', digest(token), user.id, csrf, now, now);
    cookie(req, res, token);
    return { user: publicUser(user), csrf, organization: one('SELECT name,instance_id FROM customer WHERE id=1') };
  }
  function checkOrigin(req) {
    if (['GET', 'HEAD'].includes(req.method)) return;
    const expected = origin ? [origin] : [`http://${req.headers.host}`, `https://${req.headers.host}`];
    if (req.headers.origin && !expected.includes(req.headers.origin)) fail(403, 'Cross-origin request denied');
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request denied');
  }
  const admin = actor => { if (actor?.role !== 'admin') fail(403, 'Administrator access required'); };
  function requireUser(req) {
    const actor = context(req); if (!actor) fail(401, 'Sign in to your workspace');
    if (!['GET', 'HEAD'].includes(req.method) && !equal(req.headers['x-csrf-token'], actor.csrf)) fail(403, 'Session verification failed. Reload and try again.');
    return actor;
  }
  const canRead = (actor, projectId) => actor.role === 'admin' || actor.projectIds.includes(projectId);
  function authorizeWrite(actor, kind, old, input) {
    if (actor.role === 'viewer') fail(403, 'Viewers cannot change records');
    if ((kind === 'projects' || kind === 'workstreams') && !['admin', 'manager'].includes(actor.role)) fail(403, 'Project manager access required');
    if (kind === 'projects' && !old) return;
    const ids = kind === 'projects' ? [old.id] : [old?.projectId, input.projectId || old?.projectId].filter(Boolean);
    if (ids.some(id => !canRead(actor, id))) fail(404, 'Project not found');
  }
  function assignProjects(userId, ids) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !one("SELECT id FROM records WHERE kind='projects' AND id=?", id))) fail(400, 'Select valid projects');
    sql('DELETE FROM memberships WHERE user_id=?', userId);
    for (const id of new Set(ids)) sql('INSERT INTO memberships VALUES(?,?)', userId, id);
  }
  function assignWorkstream(userId,value,role){
    const explicit=value!==undefined;
    if(explicit&&typeof value!=='string')fail(400,'Select a valid workstream');
    const id=explicit?value:one('SELECT workstream_id FROM user_workstreams WHERE user_id=?',userId)?.workstream_id||'';
    if(id){const row=one("SELECT data FROM records WHERE kind='workstreams' AND id=?",id),stream=row&&JSON.parse(row.data);const eligible=stream&&one("SELECT id FROM records WHERE kind='projects' AND id=?",stream.projectId)&&(role==='admin'||one('SELECT user_id FROM memberships WHERE user_id=? AND project_id=?',userId,stream.projectId));
      if(!eligible){if(explicit)fail(400,'Select a workstream in an assigned project');sql('DELETE FROM user_workstreams WHERE user_id=?',userId);return;}
      sql('INSERT OR REPLACE INTO user_workstreams VALUES(?,?)',userId,id);
    }else sql('DELETE FROM user_workstreams WHERE user_id=?',userId);
  }
  function grantCreator(actor, projectId) { if (actor.role !== 'admin') sql('INSERT OR IGNORE INTO memberships VALUES(?,?)', actor.id, projectId); }
  function throttle(req, identifier, limit = 10) {
    const now = Date.now();
    sql('DELETE FROM login_limits WHERE expires_at<?', now);
    for (const [key, maximum] of [[digest('ip:' + req.socket.remoteAddress), 60], [digest('account:' + identifier), limit]]) {
      const old = one('SELECT * FROM login_limits WHERE key=?', key);
      if (old?.count >= maximum) fail(429, 'Too many attempts. Try again in 15 minutes.');
      sql('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + 900000);
    }
  }
  function tokenFor(userId, purpose) {
    const token = secret();
    sql('DELETE FROM invitations WHERE user_id=?', userId);
    sql('INSERT INTO invitations VALUES(?,?,?,?)', digest(token), userId, purpose, Date.now() + (purpose === 'invite' ? 2 * DAY : 3600000));
    return { token, purpose, expiresInHours: purpose === 'invite' ? 48 : 1 };
  }
  async function handle(req, res, url, send) {
    const route = url.pathname;
    if (route === '/api/auth/status' && req.method === 'GET') { send(200, { setupRequired: !configured(), instanceId: one('SELECT instance_id FROM customer WHERE id=1').instance_id }); return true; }
    if (route === '/api/auth/setup' && req.method === 'POST') {
      throttle(req, 'setup');
      const input = await readJSON(req);
      if (configured()) fail(409, 'Workspace setup is already complete');
      if (typeof input.setupToken !== 'string' || !equal(digest(input.setupToken), one('SELECT setup_hash FROM customer WHERE id=1').setup_hash)) fail(403, 'Invalid setup code');
      const identity = validateIdentity(input);
      if (!text(input.organization)) fail(400, 'Enter your customer organization name');
      const hash = await passwordHash(input.password);
      const id = randomUUID();
      transaction(() => {
        if (configured()) fail(409, 'Workspace setup is already complete');
        sql('INSERT INTO users VALUES(?,?,?,?,?,?,1,?)', id, identity.email, identity.name, 'admin', 'active', hash, new Date().toISOString());
        sql('UPDATE customer SET name=?,setup_hash=? WHERE id=1', input.organization.trim(), '');
        audit({ id }, 'workspace.initialized', id, { organization: input.organization.trim() });
      });
      send(201, issueSession(req, res, one('SELECT * FROM users WHERE id=?', id))); return true;
    }
    if (route === '/api/auth/login' && req.method === 'POST') {
      const input = await readJSON(req); const email = normalizeEmail(input.email); throttle(req, email);
      const user = one('SELECT * FROM users WHERE email=?', email);
      const valid = await verifyPassword(input.password, user?.password_hash);
      const current = user && one('SELECT * FROM users WHERE id=?', user.id);
      if (!valid || current?.status !== 'active' || current.password_hash !== user.password_hash) { audit(null, 'login.failed'); fail(401, 'Email or password is incorrect'); }
      audit(user, 'login.succeeded', user.id); send(200, issueSession(req, res, current)); return true;
    }
    if (route === '/api/auth/accept' && req.method === 'POST') {
      const input = await readJSON(req); throttle(req, 'accept', 20);
      if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) fail(400, 'Invalid or expired invitation');
      const tokenHash = digest(input.token); const invitation = one('SELECT * FROM invitations WHERE token_hash=?', tokenHash);
      if (!invitation || invitation.expires_at < Date.now()) fail(400, 'Invalid or expired invitation');
      const hash = await passwordHash(input.password);
      const user = transaction(() => {
        const invite = one('SELECT * FROM invitations WHERE token_hash=?', tokenHash);
        const user = invite && one('SELECT * FROM users WHERE id=?', invite.user_id);
        if (!invite || invite.expires_at < Date.now() || !user || user.status === 'disabled') fail(400, 'Invalid or expired invitation');
        sql("UPDATE users SET password_hash=?,status='active',revision=revision+1 WHERE id=?", hash, user.id);
        sql('DELETE FROM invitations WHERE user_id=?', user.id); sql('DELETE FROM sessions WHERE user_id=?', user.id);
        audit(user, invite.purpose === 'invite' ? 'user.activated' : 'password.reset', user.id);
        return one('SELECT * FROM users WHERE id=?', user.id);
      });
      send(200, issueSession(req, res, user)); return true;
    }
    if (!route.startsWith('/api/auth/') && !route.startsWith('/api/admin/')) return false;
    if (!['GET', 'HEAD'].includes(req.method)) await readJSON(req);
    const actor = requireUser(req);
    if (route === '/api/auth/me' && req.method === 'GET') { send(200, { user: { id:actor.id,email:actor.email,name:actor.name,role:actor.role,status:actor.status,revision:actor.revision,projectIds:actor.projectIds,workstreamId:actor.workstreamId }, csrf: actor.csrf, organization: one('SELECT name,instance_id FROM customer WHERE id=1') }); return true; }
    if (route === '/api/auth/logout' && req.method === 'POST') { sql('DELETE FROM sessions WHERE token_hash=?', actor.sessionHash); cookie(req, res, '', true); audit(actor, 'logout', actor.id); send(200, { ok: true }); return true; }
    if (route === '/api/auth/password' && req.method === 'POST') {
      const input = await readJSON(req); throttle(req, actor.email);
      const old = one('SELECT * FROM users WHERE id=?', actor.id);
      if (!await verifyPassword(input.currentPassword, old.password_hash)) fail(400, 'Current password is incorrect');
      const hash = await passwordHash(input.password);
      transaction(() => {
        const current = one('SELECT * FROM users WHERE id=?', actor.id);
        if (current.status !== 'active' || current.password_hash !== old.password_hash) fail(409, 'Account changed. Sign in again.');
        sql('UPDATE users SET password_hash=?,revision=revision+1 WHERE id=?', hash, actor.id);
        sql('DELETE FROM sessions WHERE user_id=?', actor.id); sql('DELETE FROM invitations WHERE user_id=?', actor.id); audit(actor, 'password.changed', actor.id);
      });
      send(200, issueSession(req, res, one('SELECT * FROM users WHERE id=?', actor.id))); return true;
    }
    admin(actor);
    if (route === '/api/admin/users' && req.method === 'GET') { send(200, { users: many('SELECT * FROM users ORDER BY created_at').map(publicUser) }); return true; }
    if (route === '/api/admin/audit' && req.method === 'GET') { send(200, { events: many('SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY sequence DESC LIMIT 100').map(e => ({ ...e, details: JSON.parse(e.details) })) }); return true; }
    if (route === '/api/admin/workspace' && req.method === 'PATCH') {
      const input = await readJSON(req); if (!text(input.name)) fail(400, 'Enter an organization name');
      transaction(() => { sql('UPDATE customer SET name=? WHERE id=1', input.name.trim()); audit(actor, 'workspace.renamed', null, { name: input.name.trim() }); });
      send(200, { ok: true }); return true;
    }
    if (route === '/api/admin/users' && req.method === 'POST') {
      const input = await readJSON(req); const identity = validateIdentity(input);
      if (!roles.includes(input.role)) fail(400, 'Select a valid role');
      if (one('SELECT id FROM users WHERE email=?', identity.email)) fail(409, 'An account already exists for this email');
      const id = randomUUID();
      const link = transaction(() => {
        sql('INSERT INTO users VALUES(?,?,?,?,?,?,1,?)', id, identity.email, identity.name, input.role, 'invited', null, new Date().toISOString());
        assignProjects(id, input.projectIds || []); assignWorkstream(id,input.workstreamId,input.role); audit(actor, 'user.invited', id, { role: input.role, projectIds: input.projectIds || [], workstreamId:input.workstreamId||'' }); return tokenFor(id, 'invite');
      });
      send(201, { user: publicUser(one('SELECT * FROM users WHERE id=?', id)), ...link }); return true;
    }
    const match = route.match(/^\/api\/admin\/users\/([^/]+)(?:\/(invite|reset))?$/);
    if (match && ((req.method === 'PATCH' && !match[2]) || (req.method === 'POST' && match[2]))) {
      const input = await readJSON(req); const target = one('SELECT * FROM users WHERE id=?', match[1]);
      if (!target) fail(404, 'User not found');
      if (target.revision !== input.revision) fail(409, 'This account changed. Refresh and try again.');
      if (match[2]) {
        if (target.status === 'disabled') fail(400, 'Enable this account before creating a link');
        const purpose = target.status === 'invited' ? 'invite' : 'reset';
        const result = transaction(() => { sql('DELETE FROM sessions WHERE user_id=?', target.id); sql('UPDATE users SET revision=revision+1 WHERE id=?', target.id); audit(actor, `user.${purpose}_issued`, target.id); return tokenFor(target.id, purpose); });
        send(200, result); return true;
      }
      const name = input.name ?? target.name, role = input.role ?? target.role, status = input.status ?? target.status;
      if (!text(name) || !roles.includes(role) || !['active', 'disabled', 'invited'].includes(status) || (status === 'active' && !target.password_hash) || (target.password_hash && status === 'invited')) fail(400, 'Invalid account change');
      transaction(() => {
        if (target.status === 'active' && target.role === 'admin' && (role !== 'admin' || status !== 'active') && one("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").n <= 1) fail(409, 'Keep at least one active administrator');
        if (input.projectIds) assignProjects(target.id, input.projectIds);
        assignWorkstream(target.id,input.workstreamId,role);
        sql('UPDATE users SET name=?,role=?,status=?,revision=revision+1 WHERE id=?', name.trim(), role, status, target.id);
        sql('DELETE FROM sessions WHERE user_id=?', target.id); sql('DELETE FROM invitations WHERE user_id=?', target.id);
        audit(actor, 'user.updated', target.id, { role, status, projectIds: input.projectIds || publicUser(target).projectIds,workstreamId:publicUser(target).workstreamId });
      });
      send(200, { user: publicUser(one('SELECT * FROM users WHERE id=?', target.id)) }); return true;
    }
    fail(404, 'Not found');
  }
  return { handle, checkOrigin, requireUser, canRead, authorizeWrite, grantCreator, audit, transaction, admin };
}
