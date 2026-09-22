import type { Ledger } from './ledger.ts';
import type { ConnectionTracker } from './tracker.ts';
import type { PluginConfig } from './config.ts';
import { calculateAvailabilitySummary } from './summary.ts';

export function checkAdmin(req: any): boolean {
  if (!req || !req.context || !req.context.principal) {
    return false;
  }
  const p = req.context.principal;
  if (p.type === 'anonymous') {
    return false;
  }
  return Boolean(
    (p.type === 'user' && (p.roles?.includes('admin') || p.role === 'admin')) ||
    p.is_api_key
  );
}

function sendJson(res: any, status: number, data: any, headers: Record<string, string> = {}) {
  // Gin context
  if (typeof res?.JSON === 'function') {
    if (typeof res?.Header === 'function') {
      for (const [k, v] of Object.entries(headers)) {
        res.Header(k, v);
      }
    }
    res.JSON(status, data);
    return;
  }
  // Node.js res
  if (typeof res?.setHeader === 'function') {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
    res.end(JSON.stringify(data));
    return;
  }
  if (typeof res?.writeHead === 'function') {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(data));
    return;
  }
}

function getQuery(req: any): Record<string, string> {
  if (req?.query && typeof req.query === 'object') {
    return req.query;
  }
  const url = req?.url || req?.originalUrl || '';
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return {};
  const params = new URLSearchParams(url.slice(qIdx + 1));
  const result: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    result[k] = v;
  }
  return result;
}

export function registerRoutes(
  server: any,
  ledger: Ledger,
  tracker: ConnectionTracker,
  config: PluginConfig,
  isStorageWritable: boolean
): void {
  if (typeof server?.route !== 'function') {
    console.warn('[API] server.route is not available, skipping route registration');
    return;
  }

  // 1. Summary API (public)
  const summaryHandler = async (req: any, res: any) => {
    try {
      const q = getQuery(req);
      let days = parseInt(q.days || '30', 10);
      if (!Number.isFinite(days) || days < 1) days = 30;
      if (days > 90) days = 90;

      const uuidsStr = q.uuids ? q.uuids.trim() : '';
      if (!uuidsStr) {
        // Section 21: If uuids is absent/empty, return nodes: []
        const now = new Date();
        const start = new Date(now.getTime() - days * 86400 * 1000);
        sendJson(
          res,
          200,
          {
            schemaVersion: 1,
            generatedAt: now.toISOString(),
            windowStart: start.toISOString(),
            windowEnd: now.toISOString(),
            observerCoverage: { observableSeconds: days * 86400, unobservedSeconds: 0 },
            nodes: [],
          },
          { 'Cache-Control': 'no-store' }
        );
        return;
      }

      const uuids = uuidsStr.split(',').map((u) => u.trim()).filter(Boolean);
      const now = new Date();
      const windowStart = new Date(now.getTime() - days * 86400 * 1000);

      const events = ledger.loadEvents();
      const summary = calculateAvailabilitySummary(events, uuids, windowStart, now);

      sendJson(res, 200, summary, { 'Cache-Control': 'no-store' });
    } catch (err: any) {
      console.error('[API] Error in summaryHandler', err);
      sendJson(res, 500, { error: 'Internal Server Error' }, { 'Cache-Control': 'no-store' });
    }
  };

  server.route('GET', '/api/plugin/availability-history/v1/summary', summaryHandler);

  // 2. Events API (admin-only)
  const eventsHandler = async (req: any, res: any) => {
    try {
      if (!checkAdmin(req)) {
        sendJson(res, 403, { error: 'Forbidden: Admin access required' }, { 'Cache-Control': 'no-store' });
        return;
      }

      const q = getQuery(req);
      const uuid = q.uuid ? q.uuid.trim() : undefined;
      const from = q.from ? q.from.trim() : undefined;
      const to = q.to ? q.to.trim() : undefined;
      const limit = q.limit ? parseInt(q.limit, 10) : 100;

      const events = ledger.queryEvents({ uuid, from, to, limit });
      sendJson(res, 200, { schemaVersion: 1, count: events.length, events }, { 'Cache-Control': 'no-store' });
    } catch (err: any) {
      console.error('[API] Error in eventsHandler', err);
      sendJson(res, 500, { error: 'Internal Server Error' }, { 'Cache-Control': 'no-store' });
    }
  };

  server.route('GET', '/api/plugin/availability-history/v1/events', eventsHandler);

  // 3. Health API (admin-only)
  const healthHandler = async (req: any, res: any) => {
    try {
      if (!checkAdmin(req)) {
        sendJson(res, 403, { error: 'Forbidden: Admin access required' }, { 'Cache-Control': 'no-store' });
        return;
      }

      const events = ledger.loadEvents();
      const healthData = {
        schemaVersion: 1,
        pluginVersion: '0.1.0',
        healthy: isStorageWritable,
        sessionId: ledger.getSessionId(),
        startedAt: ledger.getStartedAt(),
        lastObserverHeartbeat: new Date().toISOString(),
        storagePath: ledger.storagePath,
        storageWritable: isStorageWritable,
        eventCount: events.length,
        trackedNodeCount: tracker.getTrackedNodeCount(),
        pendingOfflineCount: tracker.getPendingOfflineCount(),
      };

      sendJson(res, 200, healthData, { 'Cache-Control': 'no-store' });
    } catch (err: any) {
      console.error('[API] Error in healthHandler', err);
      sendJson(res, 500, { error: 'Internal Server Error' }, { 'Cache-Control': 'no-store' });
    }
  };

  server.route('GET', '/api/plugin/availability-history/v1/health', healthHandler);

  console.log('[API] Routes registered for availability-history: /summary, /events, /health');
}
