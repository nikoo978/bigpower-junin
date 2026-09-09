import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8');
const origin = 'https://pwa.example.test';
function harness() {
  const listeners = new Map();
  const stores = new Map();
  let network = async () => response('<html>shell</html>', 200, 'text/html');
  let skipped = false;
  const absolute = key => new URL(typeof key === 'string' ? key : key.url, origin + '/').href;
  function response(body, status = 200, type = 'text/javascript', headers = {}) {
    const value = new Response(body, { status, headers: { 'content-type': type, ...headers } });
    Object.defineProperty(value, 'type', { value: 'basic' });
    value.clone = () => response(body, status, type, headers);
    return value;
  }
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(key, options = {}) {
          if (!options.ignoreSearch) return entries.get(absolute(key));
          return [...entries].find(([stored]) => stored.split('?')[0] === absolute(key).split('?')[0])?.[1];
        },
        async put(key, value) { entries.set(absolute(key), value); },
        async add(key) {
          const value = await network(new Request(absolute(key)));
          if (!value.ok) throw new Error('Unavailable asset');
          entries.set(absolute(key), value);
        },
        async addAll(keys) { await Promise.all(keys.map(key => this.add(key))); },
      };
    },
  };
  vm.runInNewContext(source, {
    URL, Response, Request, Set, caches,
    fetch: request => network(request),
    self: { location: { href: origin + '/service-worker.js', origin },
      addEventListener: (name, handler) => listeners.set(name, handler),
      skipWaiting: async () => { skipped = true; }, clients: { claim: async () => {} },
    },
  });
  return { stores, caches, response, get skipped() { return skipped; },
    setNetwork(value) { network = value; },
    async lifecycle(name) {
      let work;
      listeners.get(name)({ waitUntil: promise => { work = promise; } });
      await work;
    },
    async request(path, navigate = false) {
      let result;
      const request = new Request(new URL(path, origin));
      if (navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
      listeners.get('fetch')({ request, respondWith: promise => { result = promise; } });
      return await result;
    },
  };
}

test('all declared offline resources exist in the repository', async () => {
  const assets = source.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
  for (const [, path] of assets.matchAll(/'([^']+)'/g)) {
    await access(new URL('../src/' + path.replace(/^\.\//, ''), import.meta.url));
  }
});

test('activation deletes only this application’s old caches', async () => {
  const h = harness();
  const prefix = source.match(/CACHE_PREFIX = '([^']+)'/)[1];
  await h.caches.open(prefix + 'old');
  await h.caches.open('unrelated-app');
  await h.lifecycle('install');
  assert.equal(h.skipped, true);
  await h.lifecycle('activate');
  assert.equal(h.stores.has(prefix + 'old'), false);
  assert.equal(h.stores.has('unrelated-app'), true);
});

test('a missing executable prevents activation, optional images do not', async () => {
  const h = harness();
  h.setNetwork(async request => h.response('missing', request.url.endsWith('/app.js') ? 404 : 200));
  await assert.rejects(h.lifecycle('install'));
  assert.equal(h.skipped, false);
  h.setNetwork(async request => h.response('ok', /\.(?:svg|png)$/.test(request.url) ? 404 : 200));
  await h.lifecycle('install');
  assert.equal(h.skipped, true);
});

test('server errors and offline requests preserve the usable shell', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.setNetwork(async () => h.response('upstream failure', 503));
  const fallback = await h.request('/', true);
  assert.equal(fallback.status, 200);
  assert.equal(await fallback.text(), '<html>shell</html>');
  h.setNetwork(async () => { throw new Error('offline'); });
  assert.equal((await h.request('/', true)).status, 200);
  assert.equal(await h.request('/api/private'), undefined);
  assert.equal(await h.request('https://external.example.test/app.js'), undefined);
});

test('private responses do not overwrite cached static assets', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.setNetwork(async () => h.response('private result', 200, 'text/javascript', { 'cache-control': 'private, no-store' }));
  assert.equal(await (await h.request('/app.js')).text(), 'private result');
  h.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await h.request('/app.js')).text(), '<html>shell</html>');
});
