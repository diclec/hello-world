let identity = null, csrf = '', organization = { name: 'PathToo workspace' }, customerUsers = [], auditEvents = [];
let invitationToken = new URLSearchParams(location.hash.slice(1)).get('accept');
if (invitationToken) history.replaceState(null, '', location.pathname);
sessionStorage.removeItem('pmoToken');
const roleLabel = role => ({ admin: 'Administrator', manager: 'Project manager', contributor: 'Contributor', viewer: 'Viewer' }[role] || role);
function authScreen(mode = 'login') {
  identity = null; csrf = ''; customerUsers = []; auditEvents = []; organization = { name: 'PathToo workspace' }; if(mode!=='accept') invitationToken=null; state = { projects: [], tasks: [], raid: [], workstreams: [] };
  if ($('#modal').open) $('#modal').close(); $('#modal').innerHTML='';
  const setup = mode === 'setup', accept = mode === 'accept';
  $('#app').innerHTML = `<div class="auth-page"><section class="auth-card"><div class="auth-brand">PathToo <span>PMO</span></div><div class="eyebrow">${setup ? 'YOUR CUSTOMER WORKSPACE' : 'EVERY PROJECT. THE RIGHT PEOPLE.'}</div><h1>${setup ? 'Set up your workspace' : accept ? 'Choose your password' : 'Welcome back'}</h1><p>${setup ? 'Create the first customer administrator. Existing project records will be preserved. Your setup code stops working after this step.' : accept ? 'Activate your account or complete your password reset. This link can only be used once.' : 'Sign in with your own account to continue.'}</p><form id="identity-form">${setup ? field('Organization name', 'organization', '', 'text', true) + field('Your full name', 'name', '', 'text', true) + field('Setup code (previous workspace code)', 'setupToken', '', 'password', true) : ''}${!accept ? field('Email address', 'email', '', 'email', true) : ''}<label>${accept ? 'New password' : 'Password'}<input name="password" type="password" required ${mode !== 'login' ? 'minlength="12"' : ''} maxlength="256" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>${mode !== 'login' ? '<label>Confirm password<input name="confirm" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><small>Use at least 12 characters. A long, unique passphrase works well.</small>' : ''}<p class="form-error" role="alert"></p><button type="submit" class="primary">${setup ? 'Create customer workspace' : accept ? 'Set password & sign in' : 'Sign in'}</button></form>${mode === 'login' ? '<p class="auth-help">Need an account or a password reset? Contact your customer administrator for a private setup link.</p>' : ''}${accept ? '<button class="text-button" id="back-signin">Back to sign in</button>' : ''}</section></div>`;
  if ($('#back-signin')) $('#back-signin').onclick = () => { invitationToken = null; authScreen(); };
  $('#identity-form').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(e.target));
      if (mode !== 'login' && data.confirm !== data.password) throw Error('Passwords do not match');
      delete data.confirm; if (accept) data.token = invitationToken;
      const result = await api('auth/' + (setup ? 'setup' : accept ? 'accept' : 'login'), 'POST', data);
      identity = result.user; csrf = result.csrf; organization = result.organization; invitationToken = null;
      page = 'Portfolio Home'; selected = null; await load();
    } catch (err) { e.target.querySelector('.form-error').textContent = err.message; }
    finally { button.disabled = false; }
  };
}
async function boot() {
  try {
    const status = await api('auth/status');
    if (status.setupRequired) return authScreen('setup');
    if (invitationToken) return authScreen('accept');
    try { const me = await api('auth/me'); identity = me.user; csrf = me.csrf; organization = me.organization; await load(); }
    catch (err) { if (err.status === 401) authScreen(); else throw err; }
  } catch (err) { $('#app').innerHTML = '<div class="auth-page"><section class="auth-card"><h1>Workspace unavailable</h1><p id="boot-error"></p><button class="primary" id="retry-boot">Try again</button></section></div>'; $('#boot-error').textContent = err.message; $('#retry-boot').onclick = boot; }
}
async function openAdmin() {
  if (identity.role !== 'admin') return;
  try { const [users, audit] = await Promise.all([api('admin/users'), api('admin/audit')]); customerUsers = users.users; auditEvents = audit.events; render(); }
  catch (err) { toast(err.message); }
}
function administration() {
  if (identity.role !== 'admin') return heading('WORKSPACE ACCESS', 'Administration', 'Administrator access is required.');
  return heading('YOUR CUSTOMER WORKSPACE', 'Users & access', 'Give every person the right access. Keep your customer workspace in your control.', '<button class="primary" id="invite-user">＋ Add user</button>') + `<section class="panel padded"><div class="section-heading"><div><h2>${esc(organization.name)}</h2><p>One isolated customer installation · ${customerUsers.filter(u => u.status === 'active').length} active users</p></div><button class="button" id="rename-workspace">Rename workspace</button></div><div class="role-guide"><p><b>Administrator</b> · All projects, users, and workspace settings.</p><p><b>Project manager</b> · Assigned projects, their plans, and new projects they create.</p><p><b>Contributor</b> · Tasks and RAID records in assigned projects.</p><p><b>Viewer</b> · Read-only access to assigned projects.</p></div><p class="muted">Non-administrators receive no project access until it is explicitly assigned. Invitation and password reset links are shared manually; this installation does not send email.</p></section><section class="panel user-panel"><div class="section-heading"><h2>Customer users <span class="count">${customerUsers.length}</span></h2><button class="text-button" id="refresh-users">Refresh</button></div><div class="table-scroll"><table><thead><tr><th>PERSON</th><th>ROLE</th><th>STATUS</th><th>PROJECT ACCESS</th><th>ACTIONS</th></tr></thead><tbody>${customerUsers.map(u => `<tr><td><div class="owner">${avatar(u.name)}<span><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></span></div></td><td>${esc(roleLabel(u.role))}</td><td>${badge(u.status)}</td><td>${u.role === 'admin' ? 'All projects' : u.projectIds.length + ' assigned'}</td><td><div class="user-actions"><button class="button" data-user-edit="${u.id}">Edit access</button>${u.status !== 'disabled' ? `<button class="button" data-user-link="${u.id}">${u.status === 'invited' ? 'New invite link' : 'Reset password'}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div></section><section class="panel padded"><h2>Recent audit history</h2><p>User administration, sign-ins, and record changes. The most recent 100 events are shown; earlier events remain stored.</p><div class="audit-list">${auditEvents.map(e => `<div><span><strong>${esc(e.action.replaceAll('.', ' · '))}</strong><small>${esc(e.actor_name || 'System / anonymous')} ${e.object_id ? ' · ' + esc(e.object_id) : ''}</small></span><time>${esc(new Date(e.created_at).toLocaleString())}</time></div>`).join('') || '<p>No events yet.</p>'}</div></section><section class="panel padded"><h2>Demonstration data</h2><p>New customer installations start empty. You can remove legacy example data while preserving your own records.</p><button class="danger" id="remove-demo">Remove demonstration data</button></section>`;
}
function projectCheckboxes(user = {}) {
  return `<fieldset class="project-permissions"><legend>Assigned projects</legend><p class="muted">Administrators see all projects. Other roles see only the projects selected here.</p>${state.projects.map(p => `<label><input type="checkbox" name="projectIds" value="${esc(p.id)}" ${user.projectIds?.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('') || '<p class="muted">No projects exist yet. Assign access after a project has been created.</p>'}</fieldset>`;
}
function userForm(user) {
  const d = $('#modal');
  d.innerHTML = `<form id="user-form"><div class="modal-heading"><h2>${user ? 'Edit user access' : 'Add customer user'}</h2><button type="button" class="icon-button" id="close-user" aria-label="Close">✕</button></div>${field('Full name', 'name', user?.name || '', 'text', true)}${user ? `<p class="muted">${esc(user.email)}</p>` : field('Email address', 'email', '', 'email', true)}<div class="form-grid">${selectField('Role', 'role', ['admin','manager','contributor','viewer'].map(id => ({ id, name: roleLabel(id) })), user?.role || 'viewer')}${user ? selectField('Account status', 'status', user.hasPassword ? ['active', 'disabled'] : ['invited', 'disabled'], user.status) : ''}</div>${projectCheckboxes(user)}<p class="form-error" role="alert"></p><div class="modal-footer"><button class="button" type="button" id="cancel-user">Cancel</button><button class="primary" type="submit">${user ? 'Save access' : 'Create invitation'}</button></div></form>`;
  d.showModal(); $('#close-user').onclick = $('#cancel-user').onclick = () => d.close();
  $('#user-form').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const f = new FormData(e.target), input = Object.fromEntries(f); input.projectIds = f.getAll('projectIds'); if (user) input.revision = user.revision;
      const result = await api('admin/users' + (user ? '/' + user.id : ''), user ? 'PATCH' : 'POST', input);
      d.close();
      if (result.token) showPrivateLink(result, input.name);
      if (user?.id === identity.id) { authScreen(); toast('Account updated. Sign in again.'); } else { await openAdmin(); toast(user ? 'Access updated; existing sessions revoked' : 'Invitation created'); }
    } catch (err) { e.target.querySelector('.form-error').textContent = err.message; }
    finally { button.disabled = false; }
  };
}
function showPrivateLink(result, name) {
  const d = $('#modal'), link = location.origin + '/#accept=' + result.token;
  d.innerHTML = `<div class="padded"><div class="eyebrow">SHARE PRIVATELY WITH THE ACCOUNT OWNER</div><h2>${result.purpose === 'invite' ? 'Invitation' : 'Password reset'} for ${esc(name)}</h2><p>This link expires in ${result.expiresInHours} hours and can only be used once. It is shown here once. Creating another link invalidates this one. No email has been sent.</p><label class="link-label">Private account link<input id="private-user-link" readonly value="${esc(link)}"></label><div class="modal-footer"><button class="button" id="copy-private-link">Copy link</button><button class="primary" id="close-private-link">Done</button></div><p class="muted">Copy it before closing this dialog. Opening it lets the recipient set a password.</p></div>`;
  if (!d.open) d.showModal(); $('#private-user-link').onclick = e => e.target.select();
  $('#copy-private-link').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Private link copied'); } catch { $('#private-user-link').select(); toast('Press Ctrl+C to copy the selected link'); } };
  $('#close-private-link').onclick = () => { d.close(); d.innerHTML = ''; };
}
function accountPage() { return heading('YOUR IDENTITY', 'My account', 'Manage your own credentials and sessions.') + `<section class="panel padded account-card"><h2>${esc(identity.name)}</h2><p>${esc(identity.email)} · ${esc(roleLabel(identity.role))}</p><form id="password-form"><label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>New password<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><label>Confirm new password<input name="confirm" type="password" required minlength="12" autocomplete="new-password"></label><p class="form-error" role="alert"></p><button class="primary">Change password</button></form><p class="muted">Changing your password signs out other sessions and invalidates pending reset links.</p><button class="button" id="sign-out">Sign out</button></section>`; }
function bindIdentity() {
  if ($('#invite-user')) $('#invite-user').onclick = () => userForm();
  if ($('#refresh-users')) $('#refresh-users').onclick = openAdmin;
  document.querySelectorAll('[data-user-edit]').forEach(el => el.onclick = () => userForm(customerUsers.find(u => u.id === el.dataset.userEdit)));
  document.querySelectorAll('[data-user-link]').forEach(el => el.onclick = async () => {
    const user = customerUsers.find(u => u.id === el.dataset.userLink);
    if (!confirm(`Create a new ${user.status === 'invited' ? 'invitation' : 'password reset'} link for ${user.name}? Existing sessions and previous links will be revoked.`)) return;
    try { const result = await api(`admin/users/${user.id}/${user.status === 'invited' ? 'invite' : 'reset'}`, 'POST', { revision: user.revision }); showPrivateLink(result, user.name); await openAdmin(); }
    catch (err) { toast(err.message); }
  });
  if ($('#rename-workspace')) $('#rename-workspace').onclick = () => {
    const d = $('#modal'); d.innerHTML = `<form id="workspace-form"><h2>Organization name</h2>${field('Organization name', 'name', organization.name, 'text', true)}<p class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button" id="cancel-rename">Cancel</button><button class="primary">Save name</button></div></form>`; d.showModal(); $('#cancel-rename').onclick = () => d.close(); $('#workspace-form').onsubmit = async e => { e.preventDefault(); try { const data = Object.fromEntries(new FormData(e.target)); await api('admin/workspace','PATCH',data); organization.name = data.name; d.close(); await openAdmin(); } catch (err) { e.target.querySelector('.form-error').textContent = err.message; } };
  };
  document.querySelectorAll('[data-signout],#sign-out').forEach(el => el.onclick = async () => { try { await api('auth/logout', 'POST', {}); authScreen(); } catch (err) { toast(err.message); } });
  if ($('#password-form')) $('#password-form').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
    try { const data = Object.fromEntries(new FormData(e.target)); if (data.password !== data.confirm) throw Error('Passwords do not match'); delete data.confirm; const result = await api('auth/password','POST',data); identity = result.user; csrf = result.csrf; render(); toast('Password updated; other sessions signed out'); }
    catch (err) { e.target.querySelector('.form-error').textContent = err.message; } finally { button.disabled = false; }
  };
  // Convenience in the interface; all permissions are independently checked by the server.
  const manager = ['admin','manager'].includes(identity.role), write = identity.role !== 'viewer';
  document.querySelectorAll('[data-create],[data-edit-project],[data-edit-workstream],[data-toggle-task],[data-edit-task],[data-record]').forEach(el => {
    const kind = el.dataset.create;
    if ((!write) || (!manager && (['projects','workstreams'].includes(kind) || el.hasAttribute('data-edit-project') || el.hasAttribute('data-edit-workstream')))) { el.disabled = true; el.title = 'Your role does not permit this change'; }
  });
}
