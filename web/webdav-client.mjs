const CONNECTION_ERROR = '暂时无法连接本机服务，请确认随历服务仍在运行。';
const REMOTE_ERROR = 'WebDAV 同步失败，请检查网络、文件地址、账号和读写权限后重试。';

function safeMessage(message, fallback = REMOTE_ERROR) {
 if (typeof message !== 'string' || !message.trim() || message.length > 300 || /https?:\/\/|\b(?:basic|bearer)\s|password|authorization|credential|密码[:：=]|口令[:：=]/i.test(message)) return fallback;
 return message.trim();
}

function publicStatus(value = {}) {
 return {
  syncing: value.syncing === true,
  lastSync: typeof value.lastSync === 'string' && Number.isFinite(Date.parse(value.lastSync)) ? value.lastSync : null,
  lastError: value.lastError ? safeMessage(value.lastError) : null,
  pending: Number.isSafeInteger(value.pending) && value.pending > 0 ? value.pending : 0,
 };
}

function publicConfig(value) {
 if (!value || typeof value.enabled !== 'boolean') throw new Error(CONNECTION_ERROR);
 return {
  enabled: value.enabled, url: typeof value.url === 'string' ? value.url : '', username: typeof value.username === 'string' ? value.username : '',
  hasPassword: value.hasPassword === true, configured: value.configured === true,
  revision: Number.isSafeInteger(value.revision) ? value.revision : 0, status: publicStatus(value.status),
 };
}

class WebDavClientError extends Error {
 constructor(message, httpStatus, localOnly = false) { super(message); this.name = 'WebDavClientError'; this.httpStatus = httpStatus; this.localOnly = localOnly; }
}

// This client talks only to the local calendar service. DAV credentials never
// become browser storage or part of an operation snapshot.
export class WebDavClient {
 #token; #fetch;
 constructor(token, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('缺少本机连接码，请重新打开随历。');
  this.#token = token; this.#fetch = fetchImpl.bind(globalThis); this.config = null; this.status = null;
 }
 async #request(action, body) {
  try {
   const response = await this.#fetch(`/api/webdav/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(35_000),
   });
   const result = await response.json().catch(() => ({}));
   if (result.status) this.status = publicStatus(result.status);
   if (!response.ok) {
    const localOnly = response.status === 403 && action === 'config';
    const fallback = localOnly ? 'WebDAV 设置只能从电脑本机管理，请在本机打开 localhost 或 127.0.0.1 地址。'
     : response.status === 401 ? '本机连接码已失效，请刷新随历后重试。'
     : response.status === 409 ? 'WebDAV 正在同步或设置已变更，请稍后重试。' : REMOTE_ERROR;
    throw new WebDavClientError(localOnly ? fallback : safeMessage(result.error, fallback), response.status, localOnly);
   }
   return result;
  } catch (error) {
   if (error instanceof WebDavClientError) throw error;
   throw new WebDavClientError(CONNECTION_ERROR, 0);
  }
 }
 async loadConfig() {
  const result = publicConfig(await this.#request('config'));
  this.config = result; this.status = result.status; return result;
 }
 async saveConfig(draft) {
  const body = { enabled: draft.enabled === true, url: String(draft.url ?? '').trim(), username: String(draft.username ?? '').trim() };
  if (Object.hasOwn(draft, 'password')) body.password = String(draft.password);
  const result = publicConfig(await this.#request('config', body));
  this.config = result; this.status = result.status; return result;
 }
 async synchronize() {
  const result = await this.#request('sync', {});
  this.status = publicStatus(result.status); return this.status;
 }
}

export async function exchangeWithWebDav({ transport, store, client }) {
 // Acknowledge the local service before awaiting an external server. A DAV
 // outage cannot roll back or obscure a successful local save.
 store.acceptRemote(await transport.exchange(store.snapshot));
 if (!client) return { remoteEnabled: false, remoteError: null };
 let config;
 try { config = await client.loadConfig(); }
 catch (remoteError) { return { remoteEnabled: client.config?.enabled === true, remoteError, unavailable: remoteError.localOnly === true }; }
 if (!config.enabled) return { remoteEnabled: false, remoteError: null };
 let remoteError = null;
 try { await client.synchronize(); } catch (error) { remoteError = error; }
 // The backend may have merged a downloaded version before an upload failed.
 // Always retrieve that merged history, even on a remote failure.
 store.acceptRemote(await transport.exchange(store.snapshot));
 return { remoteEnabled: true, remoteError };
}

const shortTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null;
export function describeSyncStatus({ enabled = false, status = null, syncing = false, localPending = 0, localFailed = false, lastLocalSync = null } = {}) {
 const last = shortTime(enabled ? status?.lastSync : lastLocalSync), previous = last ? ` · 上次 ${last}` : '';
 if (localFailed) return { text: `离线 · 本地已保存${enabled ? ' · WebDAV 待同步' : ''}${previous}`, failed: true };
 if (enabled) {
  const pending = Math.max(localPending, status?.pending ?? 0), queued = pending ? ` · ${pending} 项待同步` : '';
  if (syncing || status?.syncing) return { text: `本地已存 · WebDAV 同步中…${queued}`, failed: false };
  if (status?.lastError) return { text: `本地已存 · WebDAV 同步失败${queued}${previous}`, failed: true };
  if (pending) return { text: `本地已存 · WebDAV ${pending} 项待同步${previous}`, failed: false };
  return { text: last ? `WebDAV 已同步 ${last}` : '本地已存 · WebDAV 尚未同步', failed: false };
 }
 return { text: syncing ? '正在连接本机…' : localPending ? `本地已存 · ${localPending} 项待送达本机` : last ? `已保存到本机 ${last}` : '本地保存', failed: false };
}
