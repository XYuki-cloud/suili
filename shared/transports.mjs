import { mergeOperations } from './core.mjs';

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.operations)) throw new Error('Invalid sync snapshot');
  return { schemaVersion: 1, operations: mergeOperations([], snapshot.operations) };
}

export class HttpSyncTransport {
  constructor(baseUrl, token) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) server URL without credentials, query, or fragment');
    if (typeof token !== 'string' || !token.trim()) throw new Error('Sync token is required');
    this.baseUrl = url.href.replace(/\/$/, '');
    this.token = token;
  }

  async exchange(snapshot) {
    const outgoing = validateSnapshot(snapshot);
    const response = await fetch(`${this.baseUrl}/api/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(outgoing),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Sync failed (HTTP ${response.status})`);
    const incoming = validateSnapshot(await response.json());
    // A compatible server returns the union. Also merge locally so a malformed
    // or older server cannot turn this transport into a destructive overwrite.
    return { schemaVersion: 1, operations: mergeOperations(outgoing.operations, incoming.operations) };
  }
}

const MAX_WEBDAV_BYTES = 10 * 1024 * 1024;
const WEBDAV_TIMEOUT_MS = 30_000;
const WEBDAV_WRITE_ATTEMPTS = 5;
const utf8 = new TextEncoder();
class WebDavError extends Error {}

/** Validate settings without networking. Credentials are never part of a URL. */
export function normalizeWebDavConfig(config) {
  const invalid = () => { throw new WebDavError('WebDAV configuration requires a full HTTP(S) file URL and valid credentials'); };
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(config)) ||
      Object.keys(config).some(key => !['url', 'username', 'password'].includes(key))) invalid();
  const { url: rawUrl, username = '', password = '' } = config;
  if (typeof rawUrl !== 'string' || !/^https?:\/\//i.test(rawUrl) || /[\x00-\x20\x7f\\?#]/.test(rawUrl)) invalid();
  let url;
  try { url = new URL(rawUrl); } catch { invalid(); }
  const authority = rawUrl.slice(rawUrl.indexOf('://') + 3).split('/')[0];
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || authority.includes('@') ||
      url.username || url.password || url.search || url.hash || url.pathname.endsWith('/')) invalid();
  // Check the original path before URL normalization can erase dot segments.
  const rawPath = rawUrl.slice(rawUrl.indexOf('://') + 3 + authority.length);
  if (!rawPath.startsWith('/')) invalid();
  for (let segment of rawPath.split('/')) {
    for (let depth = 0; depth <= 8; depth++) {
      if (segment === '.' || segment === '..' || /[\\/\x00-\x1f\x7f]/.test(segment)) invalid();
      if (!segment.includes('%')) break;
      if (depth === 8) invalid();
      try { segment = decodeURIComponent(segment); } catch { invalid(); }
    }
  }
  if (typeof username !== 'string' || typeof password !== 'string' ||
      /[:\x00-\x1f\x7f]/.test(username) || /[\x00-\x1f\x7f]/.test(password) ||
      Boolean(username) !== Boolean(password) || [username, password].some(value => !value.isWellFormed())) invalid();
  return { url: url.href, username, password };
}

function webDavSnapshot(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
        Object.keys(snapshot).length !== 2 || !Object.hasOwn(snapshot, 'schemaVersion') || !Object.hasOwn(snapshot, 'operations')) throw new Error();
    return validateSnapshot(snapshot);
  } catch {
    // Core validation can include a remote operation ID. Do not echo it to UI.
    throw new WebDavError('WebDAV snapshot is invalid or its operation history is inconsistent');
  }
}

function webDavMerge(local, remote) {
  try { return mergeOperations(local, remote); }
  catch { throw new WebDavError('WebDAV snapshot is invalid or contains inconsistent operation IDs'); }
}

function webDavBody(snapshot) {
  const body = JSON.stringify(snapshot);
  if (utf8.encode(body).byteLength > MAX_WEBDAV_BYTES) throw new WebDavError('WebDAV snapshot exceeds the 10 MiB size limit');
  return body;
}

function basicAuthorization(username, password) {
  if (!username && !password) return null;
  const bytes = utf8.encode(`${username}:${password}`);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `Basic ${btoa(binary)}`;
}

function usableVersionTag(value) {
  if (typeof value !== 'string' || !value.length || value.length > 1024) return false;
  if (/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)) return true;
  // Nutstore/Jianguoyun returns bare opaque version tokens. Keep the server's
  // exact value for If-Match rather than inventing quotes or using a wildcard.
  return !/^w\//i.test(value) && /^[A-Za-z0-9][A-Za-z0-9._~+/:=-]*$/.test(value);
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* Only releasing an unused response. */ }
}

function webDavHttpError(status) {
  if (status === 401) return new WebDavError('WebDAV authentication failed (HTTP 401); check username and password');
  if (status === 403) return new WebDavError('WebDAV permission denied (HTTP 403); check access to the dedicated file and folder');
  if (status === 409) return new WebDavError('WebDAV parent folder is missing (HTTP 409); create the dedicated folder before syncing');
  if (status === 405 || status === 501) return new WebDavError(`WebDAV method is unsupported (HTTP ${status}); use a server supporting conditional GET/PUT`);
  return new WebDavError(`WebDAV request failed (HTTP ${status}); check server availability and file permissions`);
}

async function readWebDavSnapshot(response) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_WEBDAV_BYTES) {
    await cancelBody(response);
    throw new WebDavError('WebDAV snapshot exceeds the 10 MiB size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new WebDavError('WebDAV snapshot response is empty');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBDAV_BYTES) {
        await reader.cancel();
        throw new WebDavError('WebDAV snapshot exceeds the 10 MiB size limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return webDavSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); }
  catch { throw new WebDavError('WebDAV snapshot is invalid JSON or its operation history is inconsistent'); }
}

/** Version-conditioned writes to one dedicated JSON file. No unconditional PUT. */
export class WebDavTransport {
  #config;
  #authorization;

  constructor(config) {
    this.#config = normalizeWebDavConfig(config);
    this.#authorization = basicAuthorization(this.#config.username, this.#config.password);
  }

  async exchange(snapshot) {
    const signal = AbortSignal.timeout(WEBDAV_TIMEOUT_MS);
    let operations = webDavSnapshot(snapshot).operations;
    webDavBody({ schemaVersion: 1, operations }); // Fail oversized local input before networking.
    const request = async (method, headers = {}, body) => fetch(this.#config.url, {
      method, body, signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json', ...(this.#authorization ? { authorization: this.#authorization } : {}), ...headers },
    });
    const read = async allowMissing => {
      const response = await request('GET');
      if (allowMissing && response.status === 404) { await cancelBody(response); return null; }
      if (response.status !== 200) { await cancelBody(response); throw webDavHttpError(response.status); }
      const etag = response.headers.get('etag');
      if (!usableVersionTag(etag)) {
        await cancelBody(response);
        throw new WebDavError('WebDAV did not provide a usable ETag; empty, weak, wildcard or malformed version tags cannot be used for conditional sync');
      }
      return { snapshot: await readWebDavSnapshot(response), etag };
    };
    try {
      for (let attempt = 0; attempt < WEBDAV_WRITE_ATTEMPTS; attempt++) {
        const remote = await read(true);
        if (remote) operations = webDavMerge(operations, remote.snapshot.operations);
        const outgoing = { schemaVersion: 1, operations };
        const response = await request('PUT', {
          'content-type': 'application/json; charset=utf-8',
          ...(remote ? { 'if-match': remote.etag } : { 'if-none-match': '*' }),
        }, webDavBody(outgoing));
        await cancelBody(response);
        if (response.status === 412) continue;
        if (![200, 201, 204].includes(response.status)) throw webDavHttpError(response.status);
        const confirmed = await read(false);
        // Merge validates that common IDs have exactly equal canonical contents.
        const union = webDavMerge(operations, confirmed.snapshot.operations);
        const confirmedIds = new Set(confirmed.snapshot.operations.map(op => op.id));
        if (operations.some(op => !confirmedIds.has(op.id))) throw new WebDavError('WebDAV write confirmation is missing outgoing operations; sync was not confirmed');
        return { schemaVersion: 1, operations: union };
      }
      throw new WebDavError('WebDAV concurrent edits exceeded five conditional write attempts; retry sync later');
    } catch (error) {
      if (error instanceof WebDavError) throw error;
      if (signal.aborted) throw new WebDavError('WebDAV timed out after 30 seconds; the write is unconfirmed, retry sync');
      // Fetch errors can contain endpoint paths, credentials or server output.
      throw new WebDavError('WebDAV network or redirect failure; the write is unconfirmed, check the connection and retry sync');
    }
  }
}
