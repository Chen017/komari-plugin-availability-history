import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const zip = resolve(process.argv[2] ?? join(root, 'availability-history.zip'));
const scratch = mkdtempSync(join(tmpdir(), 'availability-history-package-'));
const require = createRequire(import.meta.url);
const windows = process.platform === 'win32';

try {
  const files = execFileSync(windows ? 'tar' : 'unzip', windows ? ['-tf', zip] : ['-Z', '-1', zip],
    { encoding: 'utf8' }).trim().split(/\r?\n/).sort();
  assert.deepEqual(files, ['assets/icon.svg', 'komari-plugin.json', 'script.js']);
  execFileSync(windows ? 'tar' : 'unzip', windows ? ['-xf', zip, '-C', scratch] : ['-q', zip, '-d', scratch]);

  const source = JSON.parse(readFileSync(join(root, 'komari-plugin.json'), 'utf8'));
  const packaged = JSON.parse(readFileSync(join(scratch, 'komari-plugin.json'), 'utf8'));
  const beta = /^availability-history-beta-([\da-f]+)\.zip$/.exec(basename(zip));
  const version = beta ? `${source.version}-beta.performance.g${beta[1]}` : source.version;
  assert.deepEqual(packaged, { ...source, version });
  assert.deepEqual(readFileSync(join(scratch, 'assets', 'icon.svg')), readFileSync(join(root, 'assets', 'icon.svg')));

  const routes = new Map();
  const hooks = [];
  const server = {
    getConfig: () => ({}),
    route: (method, path, handler) => routes.set(`${method} ${path}`, handler),
    hook: (event) => hooks.push(event),
  };
  const runtime = {
    __storageDir__: join(scratch, 'storage'),
    require: (id) => id === 'server' ? server : require(id),
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  runInNewContext(readFileSync(join(scratch, 'script.js'), 'utf8'), runtime, { filename: 'script.js' });
  assert.equal(typeof runtime.load, 'function');
  assert.equal(typeof runtime.unload, 'function');
  try {
    await runtime.load();
    assert.deepEqual(hooks, ['wsConnect', 'wsMessage', 'wsClose']);
    const health = routes.get('GET /api/plugin/availability-history/v1/health');
    assert.equal(typeof health, 'function');
    await health({ context: { principal: { type: 'user', role: 'admin' } } }, {
      JSON(status, body) {
        assert.equal(status, 200);
        assert.equal(body.healthy, true);
        assert.equal(body.pluginVersion, packaged.version);
      },
    });
  } finally {
    await runtime.unload();
  }
  console.log(`Verified ${basename(zip)} (${version}) and Komari lifecycle bridge`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
