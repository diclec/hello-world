import { createHash, randomBytes } from 'node:crypto';

export class ProvisionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const error = (code, message) => { throw new ProvisionError(code, message); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) error('INVALID_REQUEST', 'Expected a JSON object');
  const allowed = ['requestId','customerName','adminName','adminEmail'];
  if (Object.keys(input).some(key => !allowed.includes(key))) error('INVALID_REQUEST', 'Unknown request field');
  for (const key of allowed) if (typeof input[key] !== 'string') error('INVALID_REQUEST', `Missing ${key}`);
  const request = Object.fromEntries(allowed.map(key => [key,input[key].trim()]));
  request.adminEmail = request.adminEmail.toLowerCase();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(request.requestId)) error('INVALID_REQUEST', 'requestId must contain 8–80 letters, digits, underscores or hyphens');
  if (!request.customerName || request.customerName.length > 160 || !request.adminName || request.adminName.length > 160 || /[\x00-\x1f\x7f]/.test(request.customerName + request.adminName)) error('INVALID_REQUEST', 'Customer and administrator names must contain 1–160 printable characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.adminEmail) || request.adminEmail.length > 254 || /[\x00-\x1f\x7f]/.test(request.adminEmail)) error('INVALID_REQUEST', 'Enter a valid administrator email');
  return request;
}
export function customerSlug(name) {
  const normalized = name.normalize('NFKC').trim().toLowerCase();
  const prefix = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,10).replace(/-$/,'') || 'customer';
  return `c${prefix}-${hash(normalized).slice(0,8)}`;
}
export function inventoryPorts(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) error('TAILSCALE_CONFIG', 'Cannot read Tailscale Serve configuration');
  const ports = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') error('TAILSCALE_CONFIG', 'Unexpected Tailscale configuration');
    for (const key of Object.keys(node.TCP || {})) { if (!/^\d+$/.test(key)) error('TAILSCALE_CONFIG', 'Unexpected TCP port'); ports.add(Number(key)); }
    for (const key of [...Object.keys(node.Web || {}),...Object.keys(node.AllowFunnel || {})]) { const match = key.match(/:(\d+)$/); if (!match) error('TAILSCALE_CONFIG', 'Unexpected web endpoint'); ports.add(Number(match[1])); }
    for (const child of Object.values(node.Foreground || {})) visit(child);
    for (const child of Object.values(node.Services || {})) visit(child);
  };
  visit(config); return ports;
}
export function routeMatches(config, host, httpsPort, appPort) {
  const key = `${host}:${httpsPort}`;
  const handler = config.Web?.[key]?.Handlers;
  if (config.AllowFunnel?.[key]) error('PUBLIC_ROUTE', 'Funnel is enabled on the reserved customer endpoint; operator review is required');
  for (const child of Object.values(config.Foreground || {})) if (inventoryPorts(child).has(httpsPort)) error('ROUTE_CONFLICT', 'A foreground Tailscale route occupies the customer port');
  for (const child of Object.values(config.Services || {})) if (inventoryPorts(child).has(httpsPort)) error('ROUTE_CONFLICT', 'A Tailscale service occupies the customer port');
  if (!config.TCP?.[String(httpsPort)] && !handler) return false;
  const expected = `http://127.0.0.1:${appPort}`;
  if (!config.TCP?.[String(httpsPort)]?.HTTPS || !handler || Object.keys(handler).length !== 1 || handler['/']?.Proxy?.replace(/\/$/,'') !== expected) error('ROUTE_CONFLICT', 'Reserved customer port has a different Tailscale route; no routes were replaced');
  return true;
}
export async function provisionCustomer(input, platform) {
  const request = validateRequest(input);
  const fingerprint = hash(JSON.stringify([request.customerName,request.adminName,request.adminEmail]));
  const slug = customerSlug(request.customerName);
  let manifest = await platform.load(request.requestId);
  if (manifest && manifest.fingerprint !== fingerprint) error('REQUEST_CONFLICT', 'This requestId was already used with different customer information');
  const status = await platform.tailscaleStatus();
  const hostname = status.Self?.DNSName?.replace(/\.$/,'');
  if (status.BackendState !== 'Running' || !/^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$/.test(hostname || '')) error('TAILSCALE_NOT_READY', 'Sign the Pi into Tailscale and enable its tailnet HTTPS certificates first');
  let config = await platform.serveConfig();
  if (!manifest) {
    const others = await platform.list();
    if (others.some(m => m.slug === slug)) error('CUSTOMER_EXISTS', 'A customer with this name already has a deployment request. Reuse its original requestId; existing customer data was not changed');
    if (others.length >= platform.maxCustomers) error('CAPACITY_LIMIT', 'Customer installation limit reached; ask the server operator to review capacity');
    const used = inventoryPorts(config);
    const usedApps = new Set(others.map(m => m.appPort));
    const usedHttps = new Set(others.map(m => m.httpsPort));
    let appPort,httpsPort;
    for (let p=platform.appStart;p<platform.appStart+platform.portCount;p++) if (!usedApps.has(p) && !used.has(p) && await platform.portFree(p)) {appPort=p;break;}
    for (let p=platform.httpsStart;p<platform.httpsStart+platform.portCount;p++) if (!usedHttps.has(p) && !used.has(p) && p!==appPort && await platform.portFree(p)) {httpsPort=p;break;}
    if (!appPort || !httpsPort) error('NO_FREE_PORTS', 'No unused application/HTTPS ports remain in the configured ranges');
    const service = 'pathtoo-'+slug;
    await platform.assertNewPaths(service);
    manifest = { version:1,requestId:request.requestId,fingerprint,slug,service,appPort,httpsPort,hostname,portalUrl:`https://${hostname}:${httpsPort}`,request,activationToken:randomBytes(32).toString('hex'),expiresAt:Date.now()+48*3600000,createdAt:new Date().toISOString(),stage:'reserved' };
    // Reserve identity, paths, ports and token before any installation side effects.
    await platform.save(manifest);
  }
  if (manifest.hostname !== hostname) error('HOSTNAME_CHANGED', 'The Pi hostname changed after reservation; operator review is required');
  routeMatches(config,hostname,manifest.httpsPort,manifest.appPort);
  try {
    if (manifest.stage === 'reserved') {
      await platform.install(manifest);
      manifest.stage = 'installed'; await platform.save(manifest);
    }
    await platform.waitReady(manifest);
    const account = await platform.ensureAdmin(manifest);
    manifest.instanceId = account.instanceId;
    manifest.stage = 'initialized'; await platform.save(manifest);
    config = await platform.serveConfig();
    if (!routeMatches(config,hostname,manifest.httpsPort,manifest.appPort)) {
      // If inventory reports a listener at this port without our exact route, never overwrite it.
      if (inventoryPorts(config).has(manifest.httpsPort)) error('ROUTE_CONFLICT','Customer HTTPS port was claimed by another service');
      await platform.serve(manifest);
    }
    config = await platform.serveConfig();
    if (!routeMatches(config,hostname,manifest.httpsPort,manifest.appPort)) error('ROUTE_NOT_READY', 'Tailscale did not retain the private HTTPS route');
    await platform.verify(manifest);
    manifest.stage='ready';delete manifest.lastErrorCode;manifest.lastVerifiedAt=new Date().toISOString();
    let activationUrl = null;
    if (account.state === 'invited' && account.tokenMatches && Date.now() < manifest.expiresAt) activationUrl=`${manifest.portalUrl}/#accept=${manifest.activationToken}`;
    if (account.state === 'active') delete manifest.activationToken;
    await platform.save(manifest);
    return {status:'ready',requestId:request.requestId,customerName:request.customerName,adminEmail:request.adminEmail,service:manifest.service,portalUrl:manifest.portalUrl,activationUrl,activationExpiresAt:activationUrl?new Date(manifest.expiresAt).toISOString():null,adminStatus:account.state,requiresAdminLinkRecovery:account.state==='invited'&&!activationUrl,access:'tailscale-only',sampleData:false};
  } catch (e) {
    manifest.lastErrorCode = e.code || 'DEPLOYMENT_FAILED';
    await platform.save(manifest);
    throw e;
  }
}
