import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const clone = value => value === undefined ? undefined : structuredClone(value);

/** A real local HTTP WebDAV snapshot endpoint, shared by JS and Android tests.
 * inject({method, skip=0, times=1, before?, delayMs?, status?, headers?, body?, chunks?, disconnect?})
 * changes the next matching response; before(fixture, request) can model races.
 * Request records intentionally contain neither credentials nor request bodies.
 */
export async function startWebDavFixture(options = {}) {
  const path = options.path ?? '/dav/suili/calendar.json';
  const username = options.username ?? '';
  const password = options.password ?? '';
  const expectedAuth = username || password ? `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` : null;
  let snapshot = clone(options.snapshot ?? null);
  let revision = 1;
  let etagMode = options.etagMode ?? 'strong';
  const injections = [];
  const requests = [];
  const counts = { GET: 0, PUT: 0, MKCOL: 0 };
  const sockets = new Set();
  const strongEtag = () => `"revision-${revision}"`;
  const responseEtag = () => etagMode === 'missing' ? undefined : etagMode === 'weak' ? `W/${strongEtag()}` : etagMode === 'bare' ? `revision-${revision}` : strongEtag();
  const writeEtag = () => etagMode === 'bare' ? `revision-${revision}` : strongEtag();
  let fixture;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; chunks.push(chunk); }
      const request = {
        method: req.method, path: req.url, bytes,
        ifMatch: req.headers['if-match'] ?? null,
        ifNoneMatch: req.headers['if-none-match'] ?? null,
        authenticated: expectedAuth === null ? req.headers.authorization === undefined : req.headers.authorization === expectedAuth,
      };
      requests.push(request);
      counts[req.method] = (counts[req.method] ?? 0) + 1;
      if (req.url !== path) { res.writeHead(404).end(); return; }
      if (!request.authenticated) { res.writeHead(401, { 'www-authenticate': 'Basic realm="fixture", charset="UTF-8"' }).end(); return; }
      let injected;
      for (const rule of injections) {
        if (rule.times <= 0 || (rule.method && rule.method !== req.method)) continue;
        if (rule.skip > 0) { rule.skip--; continue; }
        rule.times--; injected = rule; break;
      }
      if (injected?.before) await injected.before(fixture, request);
      if (injected?.delayMs) await delay(injected.delayMs);
      if (injected?.disconnect) { req.socket.destroy(); return; }
      if (injected && (injected.status !== undefined || injected.body !== undefined || injected.chunks)) {
        res.writeHead(injected.status ?? 200, injected.headers ?? {});
        if (injected.chunks) {
          for (const chunk of injected.chunks) {
            if (chunk.delayMs) await delay(chunk.delayMs);
            if (res.destroyed) return;
            res.write(chunk.body ?? chunk);
          }
          res.end(); return;
        }
        const body = injected.body ?? '';
        res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
        return;
      }
      if (req.method === 'GET') {
        if (snapshot === null) { res.writeHead(404).end(); return; }
        const tag = responseEtag();
        res.writeHead(200, { 'content-type': 'application/json', ...(tag ? { etag: tag } : {}) });
        res.end(JSON.stringify(snapshot)); return;
      }
      if (req.method === 'PUT') {
        const exists = snapshot !== null;
        const allowed = exists ? request.ifMatch === writeEtag() && !request.ifNoneMatch : request.ifNoneMatch === '*' && !request.ifMatch;
        if (!allowed) { res.writeHead(412).end(); return; }
        snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8')); revision++;
        res.writeHead(exists ? 204 : 201, { etag: strongEtag() }).end(); return;
      }
      res.writeHead(405, { allow: 'GET, PUT' }).end();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  fixture = {
    baseUrl, url: `${baseUrl}${path}`, requests, counts,
    get snapshot() { return clone(snapshot); },
    get etag() { return snapshot === null ? null : strongEtag(); },
    setSnapshot(value) { snapshot = clone(value); revision++; },
    setEtagMode(value) { etagMode = value; },
    inject(rule) { injections.push({ skip: 0, times: 1, ...rule }); },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
  return fixture;
}
