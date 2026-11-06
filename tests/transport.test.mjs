import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpSyncTransport, WebDavTransport } from '../shared/transports.mjs';
import { emptyTask, makeOperation } from '../shared/core.mjs';
import { createServer } from '../server/server.mjs';

test('HTTP transport exchanges complete snapshots and surfaces authentication failure', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'flex-transport-'));
  const app = await createServer({ dataDir, token: 'transport-token' });
  const { url } = await app.listen(0);
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const operation = makeOperation(emptyTask('test'), [], 'desktop');
  const transport = new HttpSyncTransport(`${url}/`, 'transport-token');
  const merged = await transport.exchange({ schemaVersion: 1, operations: [operation] });
  assert.equal(merged.operations.length, 1);
  assert.equal(merged.operations[0].id, operation.id);
  assert.equal((await transport.exchange({ schemaVersion: 1, operations: [] })).operations.length, 1);
  await assert.rejects(new HttpSyncTransport(url, 'wrong').exchange({ schemaVersion: 1, operations: [] }), /401/);
  assert.throws(() => new HttpSyncTransport('file:///tmp', 'secret'));
  assert.throws(() => new HttpSyncTransport('http://user:password@localhost', 'secret'));
});

test('WebDAV requires a dedicated full file URL instead of silently accepting empty configuration', () => {
  assert.throws(() => new WebDavTransport({}), /WebDAV|URL/i);
});
