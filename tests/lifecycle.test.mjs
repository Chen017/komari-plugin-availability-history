import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { load, unload } from '../src/index.ts';

describe('Plugin Lifecycle Tests', () => {
  let tmpDir;
  let originalRequire;
  let originalStorageDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));
    originalRequire = globalThis.require;
    originalStorageDir = globalThis.__storageDir__;
    globalThis.__storageDir__ = tmpDir;
  });

  afterEach(async () => {
    await unload();
    globalThis.require = originalRequire;
    globalThis.__storageDir__ = originalStorageDir;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Test A — load() takes no parameters and acquires server via require("server")', async () => {
    let hookCalled = 0;
    let routeCalled = 0;
    let getConfigCalled = 0;

    const mockServer = {
      hook: () => { hookCalled++; },
      route: () => { routeCalled++; },
      getConfig: async () => {
        getConfigCalled++;
        return { offline_grace_seconds: 120, retention_days: 60, observer_heartbeat_seconds: 20 };
      },
    };

    globalThis.require = (id) => {
      if (id === 'server') return mockServer;
      throw new Error(`Cannot find module '${id}'`);
    };

    // load() takes no argument!
    await load();

    assert.ok(hookCalled >= 3, 'WebSocket hooks must be registered');
    assert.ok(routeCalled >= 3, 'HTTP routes must be registered');
    assert.strictEqual(getConfigCalled, 1, 'getConfig must be called');
  });

  it('Test B — missing server.hook fails load', async () => {
    const mockServer = {
      route: () => {},
      getConfig: async () => ({}),
    };

    globalThis.require = (id) => {
      if (id === 'server') return mockServer;
      throw new Error(`Cannot find module '${id}'`);
    };

    await assert.rejects(
      async () => {
        await load();
      },
      /server\.hook is unavailable/
    );
  });

  it('Test C — missing server.route fails load', async () => {
    const mockServer = {
      hook: () => {},
      getConfig: async () => ({}),
    };

    globalThis.require = (id) => {
      if (id === 'server') return mockServer;
      throw new Error(`Cannot find module '${id}'`);
    };

    await assert.rejects(
      async () => {
        await load();
      },
      /server\.route is unavailable/
    );
  });

  it('Test D — config is loaded using server.getConfig()', async () => {
    let getConfigCalled = false;
    const mockServer = {
      hook: () => {},
      route: () => {},
      getConfig: async () => {
        getConfigCalled = true;
        return {
          offline_grace_seconds: 240,
          retention_days: 120,
          observer_heartbeat_seconds: 45,
        };
      },
    };

    globalThis.require = (id) => {
      if (id === 'server') return mockServer;
      throw new Error(`Cannot find module '${id}'`);
    };

    await load();
    assert.strictEqual(getConfigCalled, true);
  });

  it('Test E — uses runtime storage directory (__storageDir__)', async () => {
    const customStorage = path.join(tmpDir, 'custom-storage-dir');
    globalThis.__storageDir__ = customStorage;

    const mockServer = {
      hook: () => {},
      route: () => {},
      getConfig: async () => ({}),
    };

    globalThis.require = (id) => {
      if (id === 'server') return mockServer;
      throw new Error(`Cannot find module '${id}'`);
    };

    await load();

    // Check that customStorage was created and used
    assert.ok(fs.existsSync(customStorage), 'Storage dir from __storageDir__ must exist');
    assert.ok(fs.existsSync(path.join(customStorage, 'observer-state.json')), 'observer-state.json must exist in __storageDir__');
  });
});
