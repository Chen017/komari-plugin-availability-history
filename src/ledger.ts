import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { LedgerEvent, NodeStateEvent, ObserverCheckpoint, ObserverGapEvent } from './types.ts';

export class Ledger {
  public readonly storagePath: string;
  private eventsFile: string;
  private checkpointFile: string;
  private currentSessionId: string = '';
  private currentStartedAt: string = '';
  private lastHeartbeatAt: string = '';

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.eventsFile = path.join(storagePath, 'events.jsonl');
    this.checkpointFile = path.join(storagePath, 'observer-state.json');
  }

  public init(): {
    isWritable: boolean;
    recoveredGap: ObserverGapEvent | null;
    sessionId: string;
  } {
    let isWritable = false;
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
      const testFile = path.join(this.storagePath, '.write-test-' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      isWritable = true;
    } catch {
      isWritable = false;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    this.currentStartedAt = nowIso;
    this.lastHeartbeatAt = nowIso;
    this.currentSessionId = crypto.randomUUID ? crypto.randomUUID() : 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    let recoveredGap: ObserverGapEvent | null = null;

    if (isWritable) {
      // Check previous observer checkpoint
      if (fs.existsSync(this.checkpointFile)) {
        try {
          const raw = fs.readFileSync(this.checkpointFile, 'utf-8');
          const prev: ObserverCheckpoint = JSON.parse(raw);
          const prevEndpoint = prev.endedAt || prev.lastHeartbeatAt;
          if (prevEndpoint) {
            const endpointMs = Date.parse(prevEndpoint);
            // If gap is more than 10 seconds or previous was not cleanly ended
            if (Number.isFinite(endpointMs) && (now.getTime() - endpointMs > 10_000 || prev.running)) {
              recoveredGap = {
                schemaVersion: 1,
                type: 'observer_gap',
                from: prevEndpoint,
                to: nowIso,
              };
              this.appendEvent(recoveredGap);
            }
          }
        } catch {
          // Ignore invalid checkpoint
        }
      }

      // Write initial checkpoint
      this.writeCheckpoint({
        schemaVersion: 1,
        sessionId: this.currentSessionId,
        startedAt: nowIso,
        lastHeartbeatAt: nowIso,
        endedAt: null,
        running: true,
      });
    }

    return {
      isWritable,
      recoveredGap,
      sessionId: this.currentSessionId,
    };
  }

  public getSessionId(): string {
    return this.currentSessionId;
  }

  public getStartedAt(): string {
    return this.currentStartedAt;
  }

  public appendEvent(event: LedgerEvent): void {
    const line = JSON.stringify(event) + '\n';
    try {
      fs.appendFileSync(this.eventsFile, line, 'utf-8');
    } catch (err) {
      console.error('[LEDGER] Failed to append event to ' + this.eventsFile, err);
    }
  }

  public loadEvents(): LedgerEvent[] {
    if (!fs.existsSync(this.eventsFile)) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.eventsFile, 'utf-8');
      const lines = content.split('\n');
      const events: LedgerEvent[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && (parsed.type === 'node_state' || parsed.type === 'observer_gap')) {
            events.push(parsed);
          }
        } catch {
          // Ignore malformed / truncated last JSONL line with warning
          if (i === lines.length - 1) {
            console.warn('[LEDGER] Ignored truncated trailing line in ' + this.eventsFile);
          }
        }
      }
      return events;
    } catch (err) {
      console.error('[LEDGER] Error loading events from ' + this.eventsFile, err);
      return [];
    }
  }

  public getLastHeartbeatAt(): string {
    return this.lastHeartbeatAt || this.currentStartedAt;
  }

  public updateHeartbeat(): void {
    const nowIso = new Date().toISOString();
    this.lastHeartbeatAt = nowIso;
    this.writeCheckpoint({
      schemaVersion: 1,
      sessionId: this.currentSessionId,
      startedAt: this.currentStartedAt,
      lastHeartbeatAt: nowIso,
      endedAt: null,
      running: true,
    });
  }

  public markCleanShutdown(): void {
    const nowIso = new Date().toISOString();
    this.lastHeartbeatAt = nowIso;
    this.writeCheckpoint({
      schemaVersion: 1,
      sessionId: this.currentSessionId,
      startedAt: this.currentStartedAt,
      lastHeartbeatAt: nowIso,
      endedAt: nowIso,
      running: false,
    });
  }

  public compact(retentionDays: number): void {
    const events = this.loadEvents();
    if (events.length === 0) return;

    const cutoffMs = Date.now() - retentionDays * 86400 * 1000;

    // For every node, keep latest pre-cutoff node_state event, and all events at/after cutoff
    const nodePreCutoffMap = new Map<string, NodeStateEvent>();
    const retainedEvents: LedgerEvent[] = [];

    for (const ev of events) {
      if (ev.type === 'node_state') {
        const atMs = Date.parse(ev.at);
        if (atMs < cutoffMs) {
          const existing = nodePreCutoffMap.get(ev.nodeUuid);
          if (!existing || Date.parse(existing.at) < atMs) {
            nodePreCutoffMap.set(ev.nodeUuid, ev);
          }
        } else {
          retainedEvents.push(ev);
        }
      } else if (ev.type === 'observer_gap') {
        const toMs = Date.parse(ev.to);
        if (toMs >= cutoffMs) {
          retainedEvents.push(ev);
        }
      }
    }

    const preCutoffAnchors = Array.from(nodePreCutoffMap.values());
    const finalEvents = [...preCutoffAnchors, ...retainedEvents].sort((a, b) => {
      const timeA = a.type === 'node_state' ? a.at : a.from;
      const timeB = b.type === 'node_state' ? b.at : b.from;
      return Date.parse(timeA) - Date.parse(timeB);
    });

    try {
      const tmpFile = this.eventsFile + '.tmp';
      const data = finalEvents.map((ev) => JSON.stringify(ev)).join('\n') + (finalEvents.length > 0 ? '\n' : '');
      fs.writeFileSync(tmpFile, data, 'utf-8');
      fs.renameSync(tmpFile, this.eventsFile);
    } catch (err) {
      console.error('[LEDGER] Compaction failed', err);
    }
  }

  public queryEvents(options: {
    uuid?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): LedgerEvent[] {
    const events = this.loadEvents();
    const fromMs = options.from ? Date.parse(options.from) : Number.NEGATIVE_INFINITY;
    const toMs = options.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;
    const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 1000);

    const filtered = events.filter((ev) => {
      if (ev.type === 'node_state') {
        if (options.uuid && ev.nodeUuid !== options.uuid) return false;
        const atMs = Date.parse(ev.at);
        return atMs >= fromMs && atMs <= toMs;
      } else {
        if (options.uuid) return false; // gaps are observer-level
        const to = Date.parse(ev.to);
        const from = Date.parse(ev.from);
        return to >= fromMs && from <= toMs;
      }
    });

    return filtered.slice(-limit);
  }

  private writeCheckpoint(checkpoint: ObserverCheckpoint): void {
    try {
      const tmp = this.checkpointFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), 'utf-8');
      fs.renameSync(tmp, this.checkpointFile);
    } catch (err) {
      console.error('[LEDGER] Failed to write observer checkpoint', err);
    }
  }
}
