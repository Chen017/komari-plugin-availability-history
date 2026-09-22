import { parsePluginConfig } from './config.ts';
import { Ledger } from './ledger.ts';
import { ConnectionTracker } from './tracker.ts';
import { registerRoutes } from './api.ts';

let ledgerInstance: Ledger | null = null;
let trackerInstance: ConnectionTracker | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let compactionTimer: NodeJS.Timeout | null = null;

export async function load(server: any): Promise<void> {
  console.log('[AVAILABILITY-HISTORY] Loading plugin...');

  const config = parsePluginConfig(server?.config);
  const ledger = new Ledger(config.storagePath);
  ledgerInstance = ledger;

  const { isWritable, recoveredGap, sessionId } = ledger.init();
  if (!isWritable) {
    console.error('[AVAILABILITY-HISTORY] Storage path is unwritable: ' + config.storagePath);
  }
  if (recoveredGap) {
    console.log('[AVAILABILITY-HISTORY] Recorded observer gap from ' + recoveredGap.from + ' to ' + recoveredGap.to);
  }

  const tracker = new ConnectionTracker({
    offlineGraceSeconds: config.offlineGraceSeconds,
    ledger,
  });
  trackerInstance = tracker;

  // Register WebSocket hooks on /api/clients/v2/rpc
  if (typeof server?.hook === 'function') {
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
  } else {
    console.warn('[AVAILABILITY-HISTORY] server.hook not found, WebSocket observation disabled');
  }

  // Register HTTP routes
  registerRoutes(server, ledger, tracker, config, isWritable);

  // Start heartbeat
  heartbeatTimer = setInterval(() => {
    ledger.updateHeartbeat();
  }, config.observerHeartbeatSeconds * 1000);

  // Daily compaction
  ledger.compact(config.retentionDays);
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

  console.log('[AVAILABILITY-HISTORY] Plugin unloaded cleanly.');
}
