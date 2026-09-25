import type { Ledger } from './ledger.ts';
import type { NodeState } from './types.ts';

export interface TrackerOptions {
  offlineGraceSeconds: number;
  ledger: Ledger;
}

export class ConnectionTracker {
  private readonly options: TrackerOptions;
  private connections = new Map<string, Set<number>>();
  private pendingTimers = new Map<string, NodeJS.Timeout>();
  private pendingDisconnectAt = new Map<string, string>();
  private lastKnownState = new Map<string, NodeState>();
  private sessionObserved = new Set<string>();

  constructor(options: TrackerOptions) {
    this.options = options;
  }

  public ensureConnectionKnown(clientUuid: string, connId: number, at: Date = new Date()): void {
    if (!clientUuid || connId === undefined || connId === null) return;

    // If node was pending offline timer, cancel it (short flap suppressed)
    if (this.pendingTimers.has(clientUuid)) {
      clearTimeout(this.pendingTimers.get(clientUuid)!);
      this.pendingTimers.delete(clientUuid);
      this.pendingDisconnectAt.delete(clientUuid);
    }

    let connSet = this.connections.get(clientUuid);
    const wasEmpty = !connSet || connSet.size === 0;

    if (!connSet) {
      connSet = new Set<number>();
      this.connections.set(clientUuid, connSet);
    }
    connSet.add(connId);

    // Re-anchor the first connection observed in this plugin session
    if (!this.sessionObserved.has(clientUuid)) {
      this.sessionObserved.add(clientUuid);
      this.lastKnownState.set(clientUuid, 'online');
      this.options.ledger.appendEvent({
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: clientUuid,
        state: 'online',
        at: at.toISOString(),
        sessionId: this.options.ledger.getSessionId(),
      });
      return;
    }

    // 0 connections -> 1 connection transition
    if (wasEmpty && this.lastKnownState.get(clientUuid) !== 'online') {
      this.lastKnownState.set(clientUuid, 'online');
      this.options.ledger.appendEvent({
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: clientUuid,
        state: 'online',
        at: at.toISOString(),
        sessionId: this.options.ledger.getSessionId(),
      });
    }
  }

  public handleConnectionClose(clientUuid: string, connId: number, at: Date = new Date()): void {
    if (!clientUuid || connId === undefined || connId === null) return;

    const connSet = this.connections.get(clientUuid);
    if (!connSet) return;

    connSet.delete(connId);

    // If other connections remain, do nothing
    if (connSet.size > 0) {
      return;
    }

    // Last connection closed -> start pending offline grace timer
    const disconnectAt = at.toISOString();
    this.pendingDisconnectAt.set(clientUuid, disconnectAt);

    const timer = setTimeout(() => {
      this.onGraceExpired(clientUuid);
    }, this.options.offlineGraceSeconds * 1000);

    this.pendingTimers.set(clientUuid, timer);
  }

  public onGraceExpired(clientUuid: string): void {
    const connSet = this.connections.get(clientUuid);
    if (connSet && connSet.size > 0) {
      // Reconnected during timer resolution
      this.pendingTimers.delete(clientUuid);
      this.pendingDisconnectAt.delete(clientUuid);
      return;
    }

    // Confirm offline with original disconnect timestamp
    const disconnectAt = this.pendingDisconnectAt.get(clientUuid) || new Date().toISOString();
    this.pendingTimers.delete(clientUuid);
    this.pendingDisconnectAt.delete(clientUuid);

    this.lastKnownState.set(clientUuid, 'offline');
    this.options.ledger.appendEvent({
      schemaVersion: 1,
      type: 'node_state',
      nodeUuid: clientUuid,
      state: 'offline',
      at: disconnectAt,
      sessionId: this.options.ledger.getSessionId(),
    });
  }

  public getTrackedNodeCount(): number {
    return this.connections.size;
  }

  public getPendingOfflineCount(): number {
    return this.pendingTimers.size;
  }

  public clearAllTimers(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.pendingDisconnectAt.clear();
  }
}
