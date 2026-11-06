import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeOperations } from '../shared/core.mjs';
import { WebDavService } from './webdav-service.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotOf = operations => ({ schemaVersion: 1, operations });
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const error = (status, message) => Object.assign(new Error(message), { status });

function snapshotOperations(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.operations)) throw error(400, 'Invalid schemaVersion or operations array');
  return value.operations;
}

async function atomicWrite(filename, contents) {
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  let file;
  let committed = false;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(contents, 'utf8');
    await file.sync();
    await file.close(); file = undefined;
    await rename(temporary, filename);
    committed = true;
    // Do not perform fallible durability work after the atomic commit: callers
    // must update memory whenever rename succeeded. Directory-entry durability
    // during a sudden OS/power failure remains filesystem-dependent.
  } finally {
    if (file) await file.close();
    if (!committed) await rm(temporary, { force: true });
  }
}

async function readJsonBody(request, maxBytes) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > maxBytes) {
    request.resume();
    throw error(413, `Request body exceeds ${maxBytes} bytes`);
  }
  const chunks = [];
  let size = 0;
  // Event listeners allow a 413 response without destroying the request socket.
  return new Promise((resolveBody, reject) => {
    let failed = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!failed) { failed = true; chunks.length = 0; reject(error(413, `Request body exceeds ${maxBytes} bytes`)); }
      } else if (!failed) chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(error(400, 'Invalid JSON request body')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(error(400, 'Request aborted')));
  });
}

function secureHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('Cache-Control', 'no-store');
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function authorize(request, token) {
  const given = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw error(401, 'Authentication required');
}

function localSetupAllowed(request, port) {
  const peer = request.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return false;
  const host = request.headers.host;
  if (!host || ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase())) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;
  return true;
}

function addresses(port) {
  const results = new Set([`http://127.0.0.1:${port}`]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const address of entries ?? []) if (!address.internal && address.family === 'IPv4') results.add(`http://${address.address}:${port}`);
  }
  return [...results];
}

function within(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw error(405, 'Method not allowed');
  const inShared = pathname.startsWith('/shared/');
  const root = join(projectRoot, inShared ? 'shared' : 'web');
  const suffix = inShared ? pathname.slice('/shared/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1).replace(/^web\//, '');
  const requested = resolve(root, suffix);
  if (!within(root, requested)) throw error(403, 'Forbidden path');
  let canonicalRoot, canonicalPath;
  try { [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(requested)]); }
  catch (cause) { if (['ENOENT', 'ENOTDIR', 'EINVAL'].includes(cause.code)) throw error(404, 'Not found'); throw cause; }
  if (!within(canonicalRoot, canonicalPath)) throw error(403, 'Forbidden path');
  if (!(await stat(canonicalPath)).isFile()) throw error(404, 'Not found');
  const contents = await readFile(canonicalPath);
  response.writeHead(200, { 'Content-Type': MIME[extname(canonicalPath).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': contents.length });
  response.end(request.method === 'HEAD' ? undefined : contents);
}

/** Starts no listener until listen() is called. Data is private under dataDir. */
export async function createServer(options = {}) {
  const dataDir = resolve(options.dataDir ?? join(projectRoot, '.local'));
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockFile = join(dataDir, '.server.lock');
  const lockContent = JSON.stringify({ pid: process.pid, instance: randomBytes(16).toString('hex') });
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (cause) {
    if (cause.code === 'EEXIST') throw new Error(`Data directory is already locked: ${lockFile}. If a previous process crashed, confirm it has stopped before removing this lock file.`);
    throw cause;
  }
  try { await lock.writeFile(lockContent, 'utf8'); await lock.sync(); }
  catch (cause) { await lock.close(); await rm(lockFile, { force: true }); throw cause; }
  await lock.close();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      // Do not remove a replacement lock if an operator changed it meanwhile.
      if (await readFile(lockFile, 'utf8') === lockContent) await rm(lockFile);
    } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  };
  try { return await buildServer({ ...options, dataDir }, release); }
  catch (cause) { await release(); throw cause; }
}

async function buildServer({ dataDir, token: requestedToken, port: defaultPort = 4317, maxBodyBytes = 10 * 1024 * 1024, webdavAutomatic = true, credentialStore, webdavTransportFactory }, release) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('maxBodyBytes must be a positive integer');
  const tokenFile = join(dataDir, 'token');
  let token;
  try { token = (await readFile(tokenFile, 'utf8')).trim(); }
  catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  if (requestedToken !== undefined && (typeof requestedToken !== 'string' || !requestedToken.trim() || /\s/.test(requestedToken))) throw new Error('Token must be a nonempty string without whitespace');
  if (token !== undefined && requestedToken !== undefined && token !== requestedToken) throw new Error('Configured token differs from persisted token');
  if (token === undefined) {
    token = requestedToken ?? randomBytes(32).toString('hex');
    // Exclusive creation avoids silently rotating an already established token.
    const tokenHandle = await open(tokenFile, 'wx', 0o600);
    try { await tokenHandle.writeFile(token, 'utf8'); await tokenHandle.sync(); }
    finally { await tokenHandle.close(); }
  }
  if (!token || /\s/.test(token)) throw new Error('Persisted token is invalid');
  const snapshotFile = join(dataDir, 'snapshot.json');
  let operations = [];
  try { operations = mergeOperations([], snapshotOperations(JSON.parse(await readFile(snapshotFile, 'utf8')))); }
  catch (cause) { if (cause.code !== 'ENOENT') throw new Error('Cannot read existing snapshot; data was not replaced', { cause }); }
  let writes = Promise.resolve();
  let listeningPort = defaultPort;
  const persistIncoming = (incoming, guard = () => {}) => {
    const exchange = writes.then(async () => {
      guard();
      let merged;
      try { merged = mergeOperations(operations, incoming); }
      catch (cause) { throw error(400, cause.message); }
      await atomicWrite(snapshotFile, `${JSON.stringify(snapshotOf(merged))}\n`);
      operations = merged;
      return snapshotOf(merged);
    });
    writes = exchange.catch(() => {});
    return exchange;
  };
  const webdav = await WebDavService.create({
    dataDir, credentialStore, automatic: webdavAutomatic, transportFactory: webdavTransportFactory,
    getSnapshot: async () => { await writes; return snapshotOf(operations); },
    mergeSnapshot: (snapshot, guard) => persistIncoming(snapshotOperations(snapshot), guard),
  });
  const server = http.createServer(async (request, response) => {
    secureHeaders(response);
    try {
      // Inspect before URL normalization; encoded separators and traversal must
      // not accidentally become a different approved static route.
      let pathname;
      try { pathname = decodeURIComponent((request.url ?? '/').split('?')[0]); }
      catch { throw error(400, 'Malformed URL'); }
      if (!pathname.startsWith('/') || pathname.includes('\\') || /[\x00-\x1f\x7f]/.test(pathname) || pathname.split('/').some(part => part === '..' || part === '.')) throw error(400, 'Invalid path');
      if (pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, schemaVersion: 1 });
      if (pathname === '/api/version' && request.method === 'GET') return json(response, 200, { version: '0.5.0', features: ['webdav'] });
      if (pathname === '/api/setup') {
        if (request.method !== 'GET') throw error(405, 'Method not allowed');
        if (!localSetupAllowed(request, listeningPort)) throw error(403, 'Setup requires a local same-origin request');
        return json(response, 200, { token, addresses: addresses(listeningPort), port: listeningPort });
      }
      if (pathname.startsWith('/api/webdav/')) {
        authorize(request, token);
        if (pathname === '/api/webdav/config') {
          if (!localSetupAllowed(request, listeningPort)) throw error(403, 'WebDAV settings require a local same-origin request');
          if (request.method === 'GET') return json(response, 200, await webdav.publicConfig());
          if (request.method !== 'POST') throw error(405, 'Method not allowed');
          return json(response, 200, await webdav.saveConfig(await readJsonBody(request, 32768)));
        }
        if (pathname === '/api/webdav/status' && request.method === 'GET') return json(response, 200, await webdav.status());
        if (pathname === '/api/webdav/sync' && request.method === 'POST') {
          await readJsonBody(request, 1024);
          try { await webdav.sync(); return json(response, 200, { ok: true, status: await webdav.status() }); }
          catch (cause) { return json(response, cause.status ?? 502, { error: cause.message, status: await webdav.status() }); }
        }
        throw error(404, 'Not found');
      }
      if (pathname === '/api/sync') {
        authorize(request, token);
        if (request.method === 'GET') { await writes; return json(response, 200, snapshotOf(operations)); }
        if (request.method !== 'POST') throw error(405, 'Method not allowed');
        const incoming = snapshotOperations(await readJsonBody(request, maxBodyBytes));
        const merged = await persistIncoming(incoming);
        webdav.notifyChanged();
        return json(response, 200, merged);
      }
      if (pathname.startsWith('/api/')) throw error(404, 'Not found');
      await serveStatic(request, response, pathname);
    } catch (cause) {
      if (!response.headersSent) json(response, cause.status ?? 500, { error: cause.status ? cause.message : 'Internal server error; existing data retained' });
      else response.destroy();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  let closed = false;
  return {
    server, token,
    async listen(port = defaultPort, host = '127.0.0.1') {
      if (closed) throw new Error('Server instance is closed');
      if (server.listening) throw new Error('Server is already listening');
      try {
        await new Promise((resolveListen, reject) => {
          server.once('error', reject);
          server.listen(port, host, () => { server.removeListener('error', reject); resolveListen(); });
        });
      } catch (cause) { closed = true; await release(); throw cause; }
      listeningPort = server.address().port;
      webdav.start();
      return { host, port: listeningPort, url: `http://${host.includes(':') ? `[${host}]` : host}:${listeningPort}` };
    },
    async close() {
      if (closed) return;
      closed = true;
      await webdav.close();
      if (server.listening) await new Promise((resolveClose, reject) => server.close(cause => cause ? reject(cause) : resolveClose()));
      await writes;
      await release();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const portIndex = args.indexOf('--port');
    const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4317;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const app = await createServer({ port });
    await app.listen(port, args.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
    console.log(`Calendar is running at http://127.0.0.1:${port}${args.includes('--lan') ? ' (LAN enabled)' : ''}`);
    console.log('Open the pairing screen locally to view the token.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
  } catch (cause) { console.error(`Calendar startup failed: ${cause.message}`); process.exitCode = 1; }
}
