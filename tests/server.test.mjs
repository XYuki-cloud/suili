import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createServer } from '../server/server.mjs';
import { emptyTask, makeOperation } from '../shared/core.mjs';

const snapshot = operations => ({ schemaVersion: 1, operations });
const auth = { authorization: 'Bearer test-secret', 'content-type': 'application/json' };
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'flex-calendar-'));
  const app = await createServer({ dataDir, token: 'test-secret', ...options });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { app, dataDir, url: address.url, port: address.port };
}
function rawRequest(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers }, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers })); });
    req.on('error', reject);
  });
}

test('health is public and sync requires a bearer token', async t => {
  const { url } = await fixture(t);
  assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { ok: true, schemaVersion: 1 });
  assert.equal((await fetch(`${url}/api/sync`)).status, 401);
  assert.equal((await fetch(`${url}/api/sync`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.deepEqual(await (await fetch(`${url}/api/sync`, { headers: auth })).json(), snapshot([]));
});

test('pairing token is only exposed through a loopback host and same-origin request', async t => {
  const { url, port } = await fixture(t);
  const setup = await (await fetch(`${url}/api/setup`, { headers: { origin: url } })).json();
  assert.equal(setup.token, 'test-secret');
  assert.equal(setup.port, port);
  assert.ok(Array.isArray(setup.addresses));
  for (const origin of ['https://evil.example', 'null', `http://localhost:${port + 1}`]) assert.equal((await fetch(`${url}/api/setup`, { headers: { origin } })).status, 403);
  for (const host of [`evil.example:${port}`, `192.168.1.2:${port}`, `localhost.evil.example:${port}`]) assert.equal((await rawRequest(port, '/api/setup', { host })).status, 403);
  assert.equal((await rawRequest(port, '/api/setup', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await fetch(`${url}/api/setup`)).headers.get('access-control-allow-origin'), null);
});

test('sync merges and persists atomically, supports retries and survives restart', async t => {
  const { app, dataDir, url } = await fixture(t);
  const a = makeOperation(emptyTask('first'), [], 'desktop', { id: 'a' });
  const b = makeOperation({ ...a.task, completed: true }, [a], 'phone', { id: 'b' });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${url}/api/sync`, { method: 'POST', headers: auth, body: JSON.stringify(snapshot([b, a])) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).operations.length, 2);
  }
  const before = await readFile(join(dataDir, 'snapshot.json'), 'utf8');
  const invalid = { ...b, id: 'invalid', parents: ['missing'] };
  const additional = makeOperation(emptyTask('must not be partially accepted'), [], 'phone');
  assert.equal((await fetch(`${url}/api/sync`, { method: 'POST', headers: auth, body: JSON.stringify(snapshot([additional, invalid])) })).status, 400);
  assert.equal(await readFile(join(dataDir, 'snapshot.json'), 'utf8'), before);
  assert.deepEqual((await readdir(dataDir)).filter(name => name.endsWith('.tmp')), []);
  await app.close();
  const restarted = await createServer({ dataDir });
  t.after(() => restarted.close());
  assert.equal(restarted.token, 'test-secret');
  const address = await restarted.listen(0);
  const restored = await (await fetch(`${address.url}/api/sync`, { headers: auth })).json();
  assert.equal(restored.operations.length, 2);
  assert.equal(restored.operations.find(x => x.id === 'b').task.completed, true);
});

test('chunked bodies are bounded even without a content-length header', async t => {
  const { port, url } = await fixture(t, { maxBodyBytes: 128 });
  const result = await new Promise((resolveResponse, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/sync', method: 'POST', headers: auth }, response => {
      response.resume();
      response.on('end', () => resolveResponse(response.statusCode));
    });
    req.on('error', reject);
    req.write('x'.repeat(80));
    req.write('x'.repeat(80));
    req.end();
  });
  assert.equal(result, 413);
  assert.deepEqual(await (await fetch(`${url}/api/sync`, { headers: auth })).json(), snapshot([]));
});

test('disk failure is not acknowledged and does not publish unpersisted operations', async t => {
  const { dataDir, url } = await fixture(t);
  // A directory at the target filename makes the atomic rename fail on all OSes.
  await mkdir(join(dataDir, 'snapshot.json'));
  const operation = makeOperation(emptyTask('must remain queued'), [], 'desktop');
  const request = () => fetch(`${url}/api/sync`, { method: 'POST', headers: auth, body: JSON.stringify(snapshot([operation])) });
  assert.equal((await request()).status, 500);
  assert.deepEqual(await (await fetch(`${url}/api/sync`, { headers: auth })).json(), snapshot([]));
  assert.deepEqual((await readdir(dataDir)).filter(name => name.endsWith('.tmp')), []);
  await rm(join(dataDir, 'snapshot.json'), { recursive: true });
  assert.equal((await request()).status, 200);
  assert.equal((await (await fetch(`${url}/api/sync`, { headers: auth })).json()).operations.length, 1);
});

test('startup fails on corrupt existing data without replacing it', async t => {
  const { app, dataDir } = await fixture(t);
  await app.close();
  await writeFile(join(dataDir, 'snapshot.json'), 'corrupt', 'utf8');
  await assert.rejects(createServer({ dataDir }), /not replaced/);
  assert.equal(await readFile(join(dataDir, 'snapshot.json'), 'utf8'), 'corrupt');
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(snapshot([])), 'utf8');
  const recovered = await createServer({ dataDir });
  await recovered.close();
});

test('a data directory has a single writer even when instances use different ports', async t => {
  const { app, dataDir } = await fixture(t);
  await assert.rejects(app.listen(0), /already|listen/i);
  await assert.rejects(createServer({ dataDir, port: 4318 }), /lock|already|独占/i);
  await app.close();
  const next = await createServer({ dataDir });
  await next.close();
});

test('simultaneous posts retain all independent writes', async t => {
  const { url } = await fixture(t);
  const operations = Array.from({ length: 12 }, (_, i) => makeOperation(emptyTask(`task ${i}`), [], 'desktop'));
  const responses = await Promise.all(operations.map(operation => fetch(`${url}/api/sync`, { method: 'POST', headers: auth, body: JSON.stringify(snapshot([operation])) })));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await (await fetch(`${url}/api/sync`, { headers: auth })).json()).operations.length, 12);
});

test('malformed, wrong-schema and oversized payloads are rejected before persistence', async t => {
  const { url } = await fixture(t, { maxBodyBytes: 128 });
  for (const body of ['{', '{"schemaVersion":2,"operations":[]}', '{"schemaVersion":1,"operations":{}}']) assert.equal((await fetch(`${url}/api/sync`, { method: 'POST', headers: auth, body })).status, 400);
  assert.equal((await fetch(`${url}/api/sync`, { method: 'POST', headers: auth, body: 'x'.repeat(129) })).status, 413);
  assert.deepEqual(await (await fetch(`${url}/api/sync`, { headers: auth })).json(), snapshot([]));
});

test('static routing never exposes credentials or traverses outside approved roots', async t => {
  const { port } = await fixture(t);
  for (const path of ['/.local/token', '/server/server.mjs', '/docs/sync-contract.md', '/shared/../server/server.mjs', '/shared/%2e%2e/server/server.mjs', '/shared/%2e%2e%2fserver%2fserver.mjs', '/shared/..%5cserver%5cserver.mjs', '/%00']) {
    const response = await rawRequest(port, path);
    assert.ok([400, 403, 404].includes(response.status), `${path}: ${response.status}`);
    assert.ok(!response.body.includes('test-secret'));
  }
  const module = await rawRequest(port, '/shared/core.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /javascript/);
});
