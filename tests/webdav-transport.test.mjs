import test from 'node:test';
import assert from 'node:assert/strict';
import { WebDavTransport, normalizeWebDavConfig } from '../shared/transports.mjs';
import { emptyTask, makeOperation, materialize } from '../shared/core.mjs';
import { startWebDavFixture } from './helpers/webdav-fixture.mjs';

const snapshot = (...operations) => ({ schemaVersion: 1, operations });
const operation = (title = 'task', id = crypto.randomUUID()) => makeOperation(emptyTask(title), [], 'test', { id });
const ids = value => value.operations.map(op => op.id).sort();
async function fixtureFor(t, options = {}) {
  const fixture = await startWebDavFixture(options);
  t.after(() => fixture.close());
  return fixture;
}

test('WebDAV creates a dedicated file conditionally and confirms its contents', async t => {
  const fixture = await fixtureFor(t);
  const op = operation('新任务');
  const received = await new WebDavTransport({ url: fixture.url }).exchange(snapshot(op));
  assert.deepEqual(received, snapshot(op));
  assert.deepEqual(fixture.snapshot, snapshot(op));
  assert.deepEqual(fixture.requests.map(r => r.method), ['GET', 'PUT', 'GET']);
  assert.equal(fixture.requests[1].ifNoneMatch, '*');
  assert.equal(fixture.requests[1].ifMatch, null);
});

test('WebDAV merges complete histories and uses the exact strong ETag', async t => {
  const remote = operation('remote'); const local = operation('local');
  const fixture = await fixtureFor(t, { snapshot: snapshot(remote) });
  const etag = fixture.etag;
  const received = await new WebDavTransport({ url: fixture.url }).exchange(snapshot(local));
  assert.deepEqual(ids(received), [remote.id, local.id].sort());
  assert.deepEqual(ids(fixture.snapshot), ids(received));
  assert.equal(fixture.requests[1].ifMatch, etag);
  assert.equal(fixture.requests[1].ifNoneMatch, null);
});

test('Jianguoyun bare ETag is sent unchanged in If-Match and confirmed after merging', async t => {
  const remote=operation('remote'),local=operation('local');
  const fixture=await fixtureFor(t,{snapshot:snapshot(remote),etagMode:'bare'});
  const received=await new WebDavTransport({url:fixture.url}).exchange(snapshot(local));
  assert.deepEqual(ids(received),[remote.id,local.id].sort());
  assert.equal(fixture.requests.find(r=>r.method==='PUT').ifMatch,'revision-1');
  assert.equal(fixture.requests.find(r=>r.method==='PUT').ifNoneMatch,null);
  assert.equal(fixture.counts.GET,2);
});

test('bare version tags keep 412 retry and preserve previously observed operations', async t => {
  const old=operation('previously seen'),local=operation('local'),raced=operation('racing');
  const fixture=await fixtureFor(t,{snapshot:snapshot(old),etagMode:'bare'});
  fixture.inject({method:'PUT',before:async f=>f.setSnapshot(snapshot(raced))});
  const received=await new WebDavTransport({url:fixture.url}).exchange(snapshot(local));
  assert.deepEqual(ids(received),[old.id,local.id,raced.id].sort());
  assert.deepEqual(fixture.requests.filter(r=>r.method==='PUT').map(r=>r.ifMatch),['revision-1','revision-2']);
});

test('unquoted tag compatibility never accepts wildcard, weak, multiple or malformed validators', async t => {
  for(const etag of ['*','W/raw','w/raw','raw,other','raw with space','raw\\other','raw"other','a'.repeat(1025)]){
    const fixture=await fixtureFor(t,{snapshot:snapshot(operation())});
    fixture.inject({method:'GET',headers:{etag},body:fixture.snapshot});
    await assert.rejects(new WebDavTransport({url:fixture.url}).exchange(snapshot(operation())),/ETag/);
    assert.equal(fixture.counts.PUT,0);
  }
});

test('WebDAV Basic authentication encodes Chinese and emoji as UTF-8', async t => {
  const config = { username: '用户😀', password: '密碼:🔐' };
  const fixture = await fixtureFor(t, config);
  const result = await new WebDavTransport({ url: fixture.url, ...config }).exchange(snapshot(operation()));
  assert.equal(result.operations.length, 1);
  assert.ok(fixture.requests.every(r => r.authenticated));
  assert.ok(fixture.requests.every(r => !JSON.stringify(r).includes(config.password)));
});

test('WebDAV validates configuration before any request', () => {
  const invalid = [undefined, null, [], {}, { url: 'file:///tmp/file.json' }, { url: 'https://a/user/' },
    { url: 'https://u:p@a/dav/file.json' }, { url: 'https://a/dav/file.json?secret=x' }, { url: 'https://a/dav/file.json#x' },
    { url: 'https://a/dav/%2e%2e/file.json' }, { url: 'https://a/dav/%252e%252e/file.json' },
    { url: 'https://a/dav/%2fsecret.json' }, { url: 'https://a/dav\\file.json' },
    { url: 'https://a/dav/file.json', username: 'a:b', password: 'p' },
    { url: 'https://a/dav/file.json', username: 'a\nb', password: 'p' },
    { url: 'https://a/dav/file.json', username: 'a', password: 'p\r\n' },
    { url: 'https://a/dav/file.json', username: 1 }, { url: 'https://a/dav/file.json', timeout: 1 },
    { url: 'https://a/dav/file.json', username: '', password: 'secret' },
    { url: 'https://a/dav/file.json', username: 'user', password: '' },
    { url: 'https://a/dav/file.json', username: '\ud800', password: '\udc00' }];
  for (const config of invalid) assert.throws(() => new WebDavTransport(config), /WebDAV|URL|credentials/i, JSON.stringify(config));
  assert.doesNotThrow(() => new WebDavTransport({ url: 'https://a/dav/日历.json', username: '', password: '' }));
});

test('WebDAV config normalization returns only canonical dedicated-file settings', () => {
  assert.deepEqual(normalizeWebDavConfig({ url: 'HTTPS://EXAMPLE.COM:443/dav/日历.json' }), {
    url: 'https://example.com/dav/%E6%97%A5%E5%8E%86.json', username: '', password: '',
  });
});

test('WebDAV uses one 30-second deadline across GET, PUT and retry requests', async t => {
  const fixture = await fixtureFor(t, { snapshot: snapshot() });
  fixture.inject({ method: 'PUT', status: 412, delayMs: 140, times: 10 });
  const originalTimeout = AbortSignal.timeout;
  let deadlines = 0;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 30_000);
    deadlines++;
    return originalTimeout(200);
  });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot(operation())), /timed out|超时/i);
  assert.equal(deadlines, 1);
  assert.ok(fixture.counts.PUT <= 2);
});

test('WebDAV cancels an oversized advertised body before reading it', async t => {
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', status: 200, headers: { etag: '"large"', 'content-length': String(10 * 1024 * 1024 + 1) }, chunks: ['{'] });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /10 MiB/);
  assert.equal(fixture.counts.PUT, 0);
});

test('WebDAV rejects invalid UTF-8 and malformed or multiple ETags', async t => {
  for (const etag of ['tag with space', '"one", "two"', '*']) {
    const fixture = await fixtureFor(t);
    fixture.inject({ method: 'GET', status: 200, headers: { etag }, body: snapshot() });
    await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /ETag/);
    assert.equal(fixture.counts.PUT, 0);
  }
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', status: 200, headers: { etag: '"valid"' }, body: Buffer.from([0xff, 0xfe, 0x00]) });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /snapshot/i);
  assert.equal(fixture.counts.PUT, 0);
});

test('WebDAV 412 on first creation re-fetches and preserves both clients', async t => {
  const remote = operation('created by another client'); const local = operation('local');
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'PUT', before: server => server.setSnapshot(snapshot(remote)) });
  const received = await new WebDavTransport({ url: fixture.url }).exchange(snapshot(local));
  assert.deepEqual(ids(received), [local.id, remote.id].sort());
  assert.equal(fixture.counts.PUT, 2);
  assert.equal(fixture.requests[1].ifNoneMatch, '*');
  assert.ok(fixture.requests[3].ifMatch);
});

test('WebDAV retry retains every previously observed remote operation', async t => {
  const first = operation('first remote'); const next = operation('later remote'); const local = operation('local');
  const fixture = await fixtureFor(t, { snapshot: snapshot(first) });
  fixture.inject({ method: 'PUT', before: server => server.setSnapshot(snapshot(next)) });
  const received = await new WebDavTransport({ url: fixture.url }).exchange(snapshot(local));
  assert.deepEqual(ids(received), [first.id, next.id, local.id].sort());
  assert.deepEqual(ids(fixture.snapshot), ids(received));
});

test('two simultaneous WebDAV clients preserve conflicting leaves on one task', async t => {
  const root = operation('root');
  const left = makeOperation({ ...root.task, title: 'left' }, [root], 'left');
  const right = makeOperation({ ...root.task, title: 'right' }, [root], 'right');
  const fixture = await fixtureFor(t, { snapshot: snapshot(root) });
  // Force both clients to observe the same revision; merely starting both
  // promises can otherwise serialize on a busy event loop and never race.
  let arrived=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  fixture.inject({method:'GET',times:2,before:async()=>{if(++arrived===2)release();await gate;}});
  await Promise.all([
    new WebDavTransport({ url: fixture.url }).exchange(snapshot(root, left)),
    new WebDavTransport({ url: fixture.url }).exchange(snapshot(root, right)),
  ]);
  assert.deepEqual(ids(fixture.snapshot), [root.id, left.id, right.id].sort());
  assert.equal(materialize(fixture.snapshot.operations).conflicts.length, 1);
  assert.ok(fixture.counts.PUT >= 3);
});

test('WebDAV stops after five conditional write attempts under contention', async t => {
  const fixture = await fixtureFor(t, { snapshot: snapshot() });
  fixture.inject({ method: 'PUT', status: 412, times: 20 });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot(operation())), /concurrent|重试|竞争/i);
  assert.equal(fixture.counts.PUT, 5);
  assert.equal(fixture.counts.GET, 5);
});

for (const etagMode of ['missing', 'weak']) test(`WebDAV refuses ${etagMode} ETags before PUT`, async t => {
  const fixture = await fixtureFor(t, { snapshot: snapshot(), etagMode });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot(operation())), /ETag/);
  assert.equal(fixture.counts.PUT, 0);
});

test('WebDAV rejects corrupt, unknown-field and malicious duplicate-ID snapshots before writing', async t => {
  const op = operation();
  const duplicate = { ...op, task: { ...op.task, title: 'malicious overwrite' } };
  for (const remote of [{ schemaVersion: 2, operations: [] }, { ...snapshot(), token: 'injected' }, snapshot(op, duplicate), snapshot({ ...op, parents: ['missing'] })]) {
    const fixture = await fixtureFor(t, { snapshot: remote });
    await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /invalid|snapshot|快照/i);
    assert.equal(fixture.counts.PUT, 0);
  }
  const fixture = await fixtureFor(t, { snapshot: snapshot() });
  fixture.inject({ method: 'GET', status: 200, headers: { etag: '"valid"' }, body: '<html>not JSON</html>' });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /snapshot|快照/i);
  assert.equal(fixture.counts.PUT, 0);
});

test('WebDAV rejects a local snapshot with unknown fields before networking', async t => {
  const fixture = await fixtureFor(t);
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange({ ...snapshot(), password: 'secret' }), /snapshot|快照/i);
  assert.equal(fixture.requests.length, 0);
});

test('WebDAV checks a confirming GET and cannot acknowledge missing operations', async t => {
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', skip: 1, status: 200, headers: { etag: '"other"' }, body: snapshot() });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot(operation())), /confirm|确认/i);
  assert.equal(fixture.counts.PUT, 1);
});

test('WebDAV confirmation rejects altered operation contents even when every ID remains', async t => {
  const fixture = await fixtureFor(t);
  const op = operation();
  fixture.inject({ method: 'GET', skip: 1, status: 200, headers: { etag: '"other"' }, body: snapshot({ ...op, task: { ...op.task, title: 'altered remotely' } }) });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot(op)), /inconsistent operation IDs/i);
});

test('WebDAV confirmation returns concurrent remote operations preserved after PUT', async t => {
  const fixture = await fixtureFor(t);
  const local = operation('local'); const other = operation('concurrent remote');
  fixture.inject({ method: 'GET', skip: 1, before: server => server.setSnapshot(snapshot(local, other)) });
  const result = await new WebDavTransport({ url: fixture.url }).exchange(snapshot(local));
  assert.deepEqual(ids(result), [local.id, other.id].sort());
});

test('WebDAV applies its deadline while a successful GET body is still streaming', async t => {
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', headers: { etag: '"slow"' }, chunks: ['{"schemaVersion":1,', { body: '"operations":[]}', delayMs: 220 }] });
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 30_000);
    return originalTimeout(100);
  });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /timed out/i);
  assert.equal(fixture.counts.PUT, 0);
});

test('WebDAV failed confirmation and uncertain PUT responses never acknowledge success', async t => {
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', skip: 1, status: 503, body: 'private server detail' });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot(operation())), /503|confirm|确认/);
  assert.equal(fixture.snapshot.operations.length, 1);
  const uncertain = await fixtureFor(t);
  uncertain.inject({ method: 'PUT', disconnect: true });
  await assert.rejects(new WebDavTransport({ url: uncertain.url }).exchange(snapshot(operation())), /network|网络|uncertain|未确认/i);
});

test('WebDAV sanitized actionable HTTP failures never echo server text or credentials', async t => {
  for (const status of [401, 403, 409, 500]) {
    const fixture = await fixtureFor(t, { snapshot: snapshot(), username: 'user', password: 'private-password' });
    fixture.inject({ method: status === 409 ? 'PUT' : 'GET', status, body: 'private-server-echo user private-password' });
    await assert.rejects(new WebDavTransport({ url: fixture.url, username: 'user', password: 'private-password' }).exchange(snapshot(operation())), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.doesNotMatch(error.message, /private-|http:\/\//);
      if (status === 409) assert.match(error.message, /folder|目录/i);
      return true;
    });
  }
});

test('WebDAV refuses redirect without contacting its destination', async t => {
  const destination = await fixtureFor(t);
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', status: 302, headers: { location: destination.url } });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /network|redirect|重定向|网络/i);
  assert.equal(destination.requests.length, 0);
});

test('WebDAV enforces the 10 MiB incoming and outgoing UTF-8 body limits', async t => {
  const fixture = await fixtureFor(t);
  fixture.inject({ method: 'GET', status: 200, headers: { etag: '"large"' }, body: ' '.repeat(10 * 1024 * 1024 + 1) });
  await assert.rejects(new WebDavTransport({ url: fixture.url }).exchange(snapshot()), /10 MiB|large|过大/i);
  assert.equal(fixture.counts.PUT, 0);
  const op = operation(); op.task.notes = '字'.repeat(4 * 1024 * 1024);
  const outgoingFixture = await fixtureFor(t);
  await assert.rejects(new WebDavTransport({ url: outgoingFixture.url }).exchange(snapshot(op)), /10 MiB|large|过大/i);
  assert.equal(outgoingFixture.requests.length, 0);
});
