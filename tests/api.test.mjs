import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Ledger } from '../src/ledger.ts';
import { ConnectionTracker } from '../src/tracker.ts';
import { registerRoutes } from '../src/api.ts';

describe('API routes tests', () => {
  it('registers summary, events, and health routes', () => {
    const routes = new Map();
    const mockServer = {
      route: (method, p, handler) => {
        routes.set(`${method} ${p}`, handler);
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
    try {
      const ledger = new Ledger(tmpDir);
      ledger.init();
      const tracker = new ConnectionTracker({ offlineGraceSeconds: 60, ledger });

      registerRoutes(
        mockServer,
        ledger,
        tracker,
        { offlineGraceSeconds: 60, retentionDays: 90, observerHeartbeatSeconds: 30, storagePath: tmpDir },
        true
      );

      assert.ok(routes.has('GET /api/plugin/availability-history/v1/summary'));
      assert.ok(routes.has('GET /api/plugin/availability-history/v1/events'));
      assert.ok(routes.has('GET /api/plugin/availability-history/v1/health'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('summary returns empty nodes if uuids is missing', async () => {
    const routes = new Map();
    const mockServer = {
      route: (method, p, handler) => {
        routes.set(`${method} ${p}`, handler);
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
    try {
      const ledger = new Ledger(tmpDir);
      ledger.init();
      const tracker = new ConnectionTracker({ offlineGraceSeconds: 60, ledger });
      registerRoutes(
        mockServer,
        ledger,
        tracker,
        { offlineGraceSeconds: 60, retentionDays: 90, observerHeartbeatSeconds: 30, storagePath: tmpDir },
        true
      );

      const handler = routes.get('GET /api/plugin/availability-history/v1/summary');

      let responseStatus = 0;
      let responseData = null;
      const res = {
        setHeader: () => {},
        end: (body) => {
          responseData = JSON.parse(body);
        },
      };

      await handler({ query: {} }, res);

      assert.strictEqual(responseData.schemaVersion, 1);
      assert.deepStrictEqual(responseData.nodes, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('anonymous access to /events and /health returns 403', async () => {
    const routes = new Map();
    const mockServer = {
      route: (method, p, handler) => {
        routes.set(`${method} ${p}`, handler);
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
    try {
      const ledger = new Ledger(tmpDir);
      ledger.init();
      const tracker = new ConnectionTracker({ offlineGraceSeconds: 60, ledger });
      registerRoutes(
        mockServer,
        ledger,
        tracker,
        { offlineGraceSeconds: 60, retentionDays: 90, observerHeartbeatSeconds: 30, storagePath: tmpDir },
        true
      );

      const eventsHandler = routes.get('GET /api/plugin/availability-history/v1/events');
      const healthHandler = routes.get('GET /api/plugin/availability-history/v1/health');

      let statusCode = 0;
      const res = {
        setHeader: () => {},
        end: () => {},
      };
      Object.defineProperty(res, 'statusCode', {
        set: (code) => {
          statusCode = code;
        },
        get: () => statusCode,
      });

      // Anonymous req
      await eventsHandler({ context: { principal: { type: 'anonymous' } } }, res);
      assert.strictEqual(statusCode, 403);

      statusCode = 0;
      await healthHandler({ context: { principal: { type: 'anonymous' } } }, res);
      assert.strictEqual(statusCode, 403);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
