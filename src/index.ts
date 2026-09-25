import * as path from 'node:path';
import { parsePluginConfig } from './config.ts';
import { Ledger } from './ledger.ts';
import { ConnectionTracker } from './tracker.ts';
import { registerRoutes } from './api.ts';

declare const __storageDir__: string | undefined;

let server: any = null;
let ledgerInstance: Ledger | null = null;
let trackerInstance: ConnectionTracker | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let compactionTimer: NodeJS.Timeout | null = null;

function getServer(): any {
  if (typeof require === 'function') {
    return require('server');
  }
  if (typeof (globalThis as any).require === 'function') {
    return (globalThis as any).require('server');
  }
  throw new Error('Komari server module cannot be required');
}

export async function load(): Promise<void> {
  console.log('[AVAILABILITY-HISTORY] Loading plugin...');

  try {
    server = getServer();
  } catch (err) {
    throw new Error(
      `[AVAILABILITY-HISTORY] Failed to acquire Komari server module: ${String(err)}`
    );
  }

  if (!server || typeof server !== 'object') {
    throw new Error('[AVAILABILITY-HISTORY] Komari server module is unavailable');
  }

  if (typeof server.hook !== 'function') {
    throw new Error('[AVAILABILITY-HISTORY] server.hook is unavailable');
  }

  if (typeof server.route !== 'function') {
    throw new Error('[AVAILABILITY-HISTORY] server.route is unavailable');
  }

  if (typeof server.getConfig !== 'function') {
    throw new Error('[AVAILABILITY-HISTORY] server.getConfig is unavailable');
  }

  const rawConfig = await server.getConfig();
  const config = parsePluginConfig(rawConfig);

  const storagePath =
    typeof __storageDir__ !== 'undefined' && __storageDir__
      ? __storageDir__
      : path.join('data', 'plugin-data', 'availability-history');

  const ledger = new Ledger(storagePath);
  ledgerInstance = ledger;

  const { isWritable, recoveredGap, sessionId } = ledger.init();
  if (!isWritable) {
    console.error('[AVAILABILITY-HISTORY] Storage path is unwritable: ' + storagePath);
  }
  if (recoveredGap) {
    console.log(
      '[AVAILABILITY-HISTORY] Recorded observer gap from ' +
        recoveredGap.from +
        ' to ' +
        recoveredGap.to
    );
  }

  const tracker = new ConnectionTracker({
    offlineGraceSeconds: config.offlineGraceSeconds,
    ledger,
  });
  trackerInstance = tracker;

  // Register WebSocket hooks on /api/clients/v2/rpc
  server.hook('wsConnect', '/api/clients/v2/rpc', (ctx: any) => {
    if (ctx?.clientUuid && ctx?.connId !== undefined && ctx?.connId !== null) {
      tracker.ensureConnectionKnown(ctx.clientUuid, Number(ctx.connId));
    }
  });

  server.hook('wsMessage', '/api/clients/v2/rpc', (ctx: any) => {
    // Rediscover connections after reload
    if (ctx?.clientUuid && ctx?.connId !== undefined && ctx?.connId !== null) {
      tracker.ensureConnectionKnown(ctx.clientUuid, Number(ctx.connId));
    }
  });

  server.hook('wsClose', '/api/clients/v2/rpc', (ctx: any) => {
    if (ctx?.clientUuid && ctx?.connId !== undefined && ctx?.connId !== null) {
      tracker.handleConnectionClose(ctx.clientUuid, Number(ctx.connId));
    }
  });

  console.log('[AVAILABILITY-HISTORY] Registered WebSocket hooks on /api/clients/v2/rpc');

  // Register HTTP routes
  registerRoutes(server, ledger, tracker, isWritable);

  console.log('[AVAILABILITY-HISTORY] Storage ready at ' + storagePath);

  // Start heartbeat
  heartbeatTimer = setInterval(() => {
    ledger.updateHeartbeat();
  }, config.observerHeartbeatSeconds * 1000);

  // Initial compaction
  ledger.compact(config.retentionDays);

  // Daily compaction
  compactionTimer = setInterval(() => {
    ledger.compact(config.retentionDays);
  }, 24 * 60 * 60 * 1000);

  console.log('[AVAILABILITY-HISTORY] Plugin loaded successfully (session=' + sessionId + ')');
}

export async function unload(): Promise<void> {
  console.log('[AVAILABILITY-HISTORY] Unloading plugin...');

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (compactionTimer) {
    clearInterval(compactionTimer);
    compactionTimer = null;
  }

  if (trackerInstance) {
    trackerInstance.clearAllTimers();
    trackerInstance = null;
  }

  if (ledgerInstance) {
    ledgerInstance.markCleanShutdown();
    ledgerInstance = null;
  }

  server = null;

  console.log('[AVAILABILITY-HISTORY] Plugin unloaded cleanly.');
}
