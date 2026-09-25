import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Ledger } from '../src/ledger.ts';

describe('Ledger persistence & compaction tests', () => {
  it('recovers from observer gap on startup and creates new session', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
    try {
      const ledger1 = new Ledger(tmpDir);
      const init1 = ledger1.init();
      assert.ok(init1.isWritable);
      assert.strictEqual(init1.recoveredGap, null);

      ledger1.appendEvent({
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-1',
        state: 'online',
        at: new Date(Date.now() - 3600_000).toISOString(),
        sessionId: init1.sessionId,
      });

      // Simulate unclean exit 1 hour ago
      const checkpointFile = path.join(tmpDir, 'observer-state.json');
      const prevCheckpoint = {
        schemaVersion: 1,
        sessionId: init1.sessionId,
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
        lastHeartbeatAt: new Date(Date.now() - 1800_000).toISOString(), // 30 min ago
        endedAt: null,
        running: true,
      };
      fs.writeFileSync(checkpointFile, JSON.stringify(prevCheckpoint));

      // Startup ledger 2
      const ledger2 = new Ledger(tmpDir);
      const init2 = ledger2.init();

      assert.ok(init2.recoveredGap !== null);
      assert.strictEqual(init2.recoveredGap.type, 'observer_gap');
      assert.strictEqual(init2.recoveredGap.from, prevCheckpoint.lastHeartbeatAt);

      const events = ledger2.loadEvents();
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[1].type, 'observer_gap');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('safely handles truncated trailing line in events.jsonl', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
    try {
      const ledger = new Ledger(tmpDir);
      ledger.init();

      const eventsFile = path.join(tmpDir, 'events.jsonl');
      fs.writeFileSync(
        eventsFile,
        JSON.stringify({
          schemaVersion: 1,
          type: 'node_state',
          nodeUuid: 'n1',
          state: 'online',
          at: '2026-09-22T00:00:00Z',
          sessionId: 's1',
        }) + '\n{"schemaVersion":1,"type":"node_state","no' // truncated!
      );

      const events = ledger.loadEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].nodeUuid, 'n1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('compacts events keeping pre-cutoff anchor and does not alter calculation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
    try {
      const ledger = new Ledger(tmpDir);
      ledger.init();

      const oldTime1 = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
      const oldTime2 = new Date(Date.now() - 95 * 86400 * 1000).toISOString();
      const recentTime = new Date(Date.now() - 10 * 86400 * 1000).toISOString();

      ledger.appendEvent({
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'n1',
        state: 'offline',
        at: oldTime1,
        sessionId: 's0',
      });
      ledger.appendEvent({
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'n1',
        state: 'online',
        at: oldTime2,
        sessionId: 's0',
      });
      ledger.appendEvent({
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'n1',
        state: 'offline',
        at: recentTime,
        sessionId: 's1',
      });

      // Compact with 90 days retention
      ledger.compact(90);

      const events = ledger.loadEvents();
      // Should keep oldTime2 (latest pre-cutoff anchor) and recentTime
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].at, oldTime2);
      assert.strictEqual(events[0].state, 'online');
      assert.strictEqual(events[1].at, recentTime);
      assert.strictEqual(events[1].state, 'offline');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records observer gap across a fast clean restart', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
    try {
      const endedAt = new Date(Date.now() - 1000).toISOString();
      fs.writeFileSync(
        path.join(tmpDir, 'observer-state.json'),
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'previous-session',
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          lastHeartbeatAt: endedAt,
          endedAt,
          running: false,
        })
      );

      const ledger = new Ledger(tmpDir);
      const init = ledger.init();

      assert.ok(init.recoveredGap);
      assert.strictEqual(init.recoveredGap.from, endedAt);

      const events = ledger.loadEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'observer_gap');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('defaults invalid query limit to 100 instead of returning the full ledger', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
    try {
      const ledger = new Ledger(tmpDir);
      ledger.init();

      const baseMs = Date.parse('2026-09-22T00:00:00.000Z');
      for (let i = 0; i < 105; i++) {
        ledger.appendEvent({
          schemaVersion: 1,
          type: 'node_state',
          nodeUuid: 'n1',
          state: i % 2 === 0 ? 'online' : 'offline',
          at: new Date(baseMs + i * 1000).toISOString(),
          sessionId: 's1',
        });
      }

      const events = ledger.queryEvents({ limit: Number.NaN });

      assert.strictEqual(events.length, 100);
      assert.strictEqual(events[0].at, new Date(baseMs + 5 * 1000).toISOString());
      assert.strictEqual(events[99].at, new Date(baseMs + 104 * 1000).toISOString());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

});
