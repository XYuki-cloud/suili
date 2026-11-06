import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore } from '../web/local-store.mjs';
import { emptyTask, makeOperation } from '../shared/core.mjs';

const module = await import('../web/webdav-client.mjs').catch(() => ({}));
const { WebDavClient, exchangeWithWebDav, describeSyncStatus } = module;
const status = extra => ({ syncing: false, lastSync: null, lastError: null, pending: 0, ...extra });
const config = extra => ({ enabled: true, url: 'https://dav.example/随历/calendar.json', username: 'user', hasPassword: true, configured: true, revision: 1, status: status(), ...extra });
const response = (body, httpStatus = 200) => ({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, json: async () => body });
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('WebDAV client uses only authenticated local endpoints and retains no returned password', async () => {
 assert.equal(typeof WebDavClient, 'function', 'WebDavClient must exist');
 const requests = [];
 const client = new WebDavClient('local-token', { fetchImpl: async (url, options) => { requests.push({ url, options }); return response({ ...config(), password: 'must-not-keep' }); } });
 await client.loadConfig();
 await client.saveConfig({ enabled: true, url: ' https://dav.example/随历/calendar.json ', username: ' user ', password: 'new-secret', unexpected: 'ignored' });
 assert.deepEqual(requests.map(r => r.url), ['/api/webdav/config', '/api/webdav/config']);
 assert.equal(requests[0].options.headers.authorization, 'Bearer local-token');
 assert.equal(requests[0].options.redirect, 'error');
 assert.deepEqual(JSON.parse(requests[1].options.body), { enabled: true, url: 'https://dav.example/随历/calendar.json', username: 'user', password: 'new-secret' });
 assert.equal('password' in client.config, false);
 assert.equal(JSON.stringify(client).includes('new-secret'), false);
 assert.equal(JSON.stringify(client).includes('must-not-keep'), false);
});

test('password omission and explicit clearing remain distinct when saving config', async () => {
 assert.equal(typeof WebDavClient, 'function', 'WebDavClient must exist');
 const sent = [];
 const client = new WebDavClient('local-token', { fetchImpl: async (_, options) => { sent.push(JSON.parse(options.body)); return response(config({ enabled: false })); } });
 await client.saveConfig({ enabled: false, url: '', username: '' });
 await client.saveConfig({ enabled: true, url: 'https://dav.example/calendar.json', username: '', password: '' });
 assert.equal('password' in sent[0], false);
 assert.equal(sent[1].password, '');
});

test('browser fetch keeps its Window receiver instead of receiving the client instance', async () => {
 let receiver;
 const client = new WebDavClient('local-token', { fetchImpl: async function () { receiver = this; return response(config()); } });
 await client.loadConfig();
 assert.equal(receiver, globalThis);
});

test('DAV failure preserves safe status while hiding any URL or credentials from the error', async () => {
 assert.equal(typeof WebDavClient, 'function', 'WebDavClient must exist');
 const remoteStatus = status({ lastSync: '2026-10-24T10:00:00Z', lastError: 'Failed https://user:secret@dav.example.invalid/private', pending: 3 });
 const client = new WebDavClient('local-token', { fetchImpl: async () => response({ error: remoteStatus.lastError, status: remoteStatus }, 502) });
 await assert.rejects(client.synchronize(), error => /WebDAV/.test(error.message) && !/dav\.example|secret|private/.test(error.message));
 assert.equal(client.status.pending, 3);
 assert.equal(/dav\.example|secret/.test(client.status.lastError), false);
});

test('loopback-only config rejection gives actionable local-management guidance', async () => {
 assert.equal(typeof WebDavClient, 'function', 'WebDavClient must exist');
 const client = new WebDavClient('local-token', { fetchImpl: async () => response({ error: 'forbidden' }, 403) });
 await assert.rejects(client.loadConfig(), error => error.localOnly === true && /电脑本机|localhost|127\.0\.0\.1/.test(error.message));
});

test('local acknowledgement survives DAV outage and the second local exchange still receives merged remote operations', async () => {
 assert.equal(typeof exchangeWithWebDav, 'function', 'exchangeWithWebDav must exist');
 const store = new LocalStore(memory()), task = emptyTask('本地事项'); store.commit([task]);
 const events = [], remote = makeOperation(emptyTask('远端已拉取事项'), [], 'remote');
 let exchanges = 0;
 const transport = { exchange: async snapshot => { events.push('local'); exchanges++; return { schemaVersion: 1, operations: exchanges === 1 ? snapshot.operations : [...snapshot.operations, remote] }; } };
 const client = { config: null, loadConfig: async () => { events.push('config'); client.config = config(); return client.config; }, synchronize: async () => { events.push('dav'); assert.equal(store.pending, 0); throw new Error('WebDAV 无法连接'); } };
 const result = await exchangeWithWebDav({ transport, store, client });
 assert.deepEqual(events, ['local', 'config', 'dav', 'local']);
 assert.match(result.remoteError.message, /WebDAV/);
 assert.equal(result.remoteEnabled, true);
 assert.equal(store.pending, 0);
 assert.equal(store.view.tasks.length, 2);
 assert.equal(new LocalStore(store.storage).view.tasks.length, 2);
});

test('disabled DAV sends no remote request; local endpoint failure propagates without attempting DAV', async () => {
 assert.equal(typeof exchangeWithWebDav, 'function', 'exchangeWithWebDav must exist');
 const store = new LocalStore(memory()); store.commit([emptyTask('离线事项')]);
 let remoteCalls = 0, localCalls = 0;
 const client = { loadConfig: async () => config({ enabled: false }), synchronize: async () => remoteCalls++ };
 const result = await exchangeWithWebDav({ store, client, transport: { exchange: async snapshot => { localCalls++; return snapshot; } } });
 assert.equal(result.remoteEnabled, false); assert.equal(localCalls, 1); assert.equal(remoteCalls, 0);
 store.commit([emptyTask('未送达事项')]);
 await assert.rejects(exchangeWithWebDav({ store, client, transport: { exchange: async () => { throw new Error('offline'); } } }), /offline/);
 assert.equal(store.pending, 1); assert.equal(remoteCalls, 0);
});

test('remote status never uses successful local acknowledgement as DAV success', () => {
 assert.equal(typeof describeSyncStatus, 'function', 'describeSyncStatus must exist');
 const initial = describeSyncStatus({ enabled: true, status: status({ pending: 2 }), localPending: 0, lastLocalSync: '2026-10-25T08:00:00Z' });
 assert.match(initial.text, /WebDAV.*2.*待同步/); assert.doesNotMatch(initial.text, /已同步/);
 const failed = describeSyncStatus({ enabled: true, status: status({ lastSync: '2026-10-24T10:00:00Z', lastError: '无法连接', pending: 3 }), localPending: 0 });
 assert.match(failed.text, /WebDAV.*失败.*3.*待同步.*上次/); assert.equal(failed.failed, true);
 const local = describeSyncStatus({ enabled: false, localPending: 0, lastLocalSync: '2026-10-25T08:00:00Z' });
 assert.match(local.text, /本机/); assert.doesNotMatch(local.text, /WebDAV.*已同步/);
});
