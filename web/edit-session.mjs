// A lifetime Web Lock prevents two tabs from replacing the same local snapshot.
// No localStorage lease: expiry and read/write races cannot establish ownership.
export function holdEditSession(locks, start, waiting) {
  let active = false;
  let release;
  let stopped = false;
  const controller = new AbortController();
  const session = {
    get active() { return active; },
    stop() {
      stopped = true;
      active = false;
      controller.abort();
      release?.();
    },
    done: null,
  };
  waiting();
  if (!locks?.request) throw new Error('请使用支持 Web Locks 的浏览器，从本机 localhost 或 127.0.0.1 地址打开。');
  session.done = locks.request('suili-local-calendar-writer-v1', {signal: controller.signal}, async () => {
    if (stopped) return;
    active = true;
    try {
      // Set the release callback before start can trigger navigation or throw.
      const lifetime = new Promise(resolve => { release = resolve; });
      await start(session);
      await lifetime;
    } finally { active = false; }
  }).catch(error => { if (error.name !== 'AbortError') throw error; });
  return session;
}
