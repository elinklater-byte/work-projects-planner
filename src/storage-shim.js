// Standalone-app replacement for the Claude-artifact-only `window.storage` API.
// Mirrors its contract (get() throws on a missing key; set/get/delete/list all
// resolve to { key, value/deleted, shared }) so the rest of App.jsx is unchanged.
const PREFIX = 'work-board:';

window.storage = {
  async get(key) {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) throw new Error(`Key not found: ${key}`);
    return { key, value: raw, shared: false };
  },
  async set(key, value) {
    window.localStorage.setItem(PREFIX + key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    window.localStorage.removeItem(PREFIX + key);
    return { key, deleted: true, shared: false };
  },
  async list(prefix = '') {
    const keys = Object.keys(window.localStorage)
      .filter(k => k.startsWith(PREFIX + prefix))
      .map(k => k.slice(PREFIX.length));
    return { keys, shared: false };
  },
};
