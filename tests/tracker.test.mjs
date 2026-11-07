import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionTracker } from '../src/tracker.ts';

class MockLedger {
  events = [];
  getSessionId() {
    return 'test-session-1';
  }
  appendEvent(ev) {
    this.events.push(ev);
  }
}

describe('ConnectionTracker tests', () => {
  it('handles normal outage: online -> disconnect -> grace expires -> reconnect', ({ mock }) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 180,
      ledger,
    });

    const t0 = new Date('2026-09-22T12:00:00.000Z');
    tracker.ensureConnectionKnown('node-1', 1, t0);

    assert.strictEqual(ledger.events.length, 1);
    assert.strictEqual(ledger.events[0].state, 'online');
    assert.strictEqual(ledger.events[0].at, t0.toISOString());

    // Disconnect at t1
    const t1 = new Date('2026-09-22T12:12:00.000Z');
    tracker.handleConnectionClose('node-1', 1, t1);

    // Before grace expires, no offline event
    assert.strictEqual(ledger.events.length, 1);

    mock.timers.tick(180_000);

    assert.strictEqual(ledger.events.length, 2);
    assert.strictEqual(ledger.events[1].state, 'offline');
    // Offline event must use original disconnect timestamp t1
    assert.strictEqual(ledger.events[1].at, t1.toISOString());

    // Reconnect at t2
    const t2 = new Date('2026-09-22T12:45:00.000Z');
    tracker.ensureConnectionKnown('node-1', 2, t2);

    assert.strictEqual(ledger.events.length, 3);
    assert.strictEqual(ledger.events[2].state, 'online');
    assert.strictEqual(ledger.events[2].at, t2.toISOString());
  });

  it('suppresses short flaps under grace period', ({ mock }) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 180,
      ledger,
    });

    tracker.ensureConnectionKnown('node-1', 1);
    assert.strictEqual(ledger.events.length, 1);

    // Close
    tracker.handleConnectionClose('node-1', 1);

    // Reconnect before the grace period expires.
    mock.timers.tick(30_000);
    tracker.ensureConnectionKnown('node-1', 2);

    mock.timers.tick(180_000);

    // No offline event should ever be emitted
    assert.strictEqual(ledger.events.length, 1);
    assert.strictEqual(ledger.events[0].state, 'online');
  });

  it('keeps node online if one of multiple connections closes', ({ mock }) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 180,
      ledger,
    });

    tracker.ensureConnectionKnown('node-1', 1);
    tracker.ensureConnectionKnown('node-1', 2);

    assert.strictEqual(ledger.events.length, 1); // Only 1 online event

    // Close connection 1
    tracker.handleConnectionClose('node-1', 1);
    mock.timers.tick(180_000);

    // Still online because connection 2 remains
    assert.strictEqual(ledger.events.length, 1);
  });

  it('preserves the original outage time when close events repeat', ({ mock }) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({ offlineGraceSeconds: 180, ledger });
    const disconnectedAt = new Date('2026-09-22T12:00:00.000Z');
    const duplicateAt = new Date('2026-09-22T12:01:00.000Z');

    tracker.ensureConnectionKnown('node-1', 1);
    tracker.handleConnectionClose('node-1', 1, disconnectedAt);
    mock.timers.tick(60_000);
    tracker.handleConnectionClose('node-1', 1, duplicateAt);
    tracker.handleConnectionClose('node-1', 999, duplicateAt);
    mock.timers.tick(120_000);
    assert.equal(ledger.events.at(-1).at, disconnectedAt.toISOString());

    mock.timers.tick(60_000);
    assert.deepEqual(ledger.events.map((event) => event.state), ['online', 'offline']);
  });

  it('leaves no orphan grace timer when the tracker is unloaded', ({ mock }) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({ offlineGraceSeconds: 180, ledger });

    tracker.ensureConnectionKnown('node-1', 1);
    tracker.handleConnectionClose('node-1', 1);
    tracker.handleConnectionClose('node-1', 1);
    tracker.clearAllTimers();
    mock.timers.tick(180_000);

    assert.deepEqual(ledger.events.map((event) => event.state), ['online']);
  });

  it('deduplicates repeated wsMessage calls', () => {
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 1,
      ledger,
    });

    tracker.ensureConnectionKnown('node-1', 1);
    tracker.ensureConnectionKnown('node-1', 1);
    tracker.ensureConnectionKnown('node-1', 1);

    assert.strictEqual(ledger.events.length, 1);
  });

  it('re-anchors post-gap connection with fresh online event on reload', () => {
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 1,
      ledger,
    });

    // Node is rediscovered in this session via wsMessage
    tracker.ensureConnectionKnown('node-1', 42);

    assert.strictEqual(ledger.events.length, 1);
    assert.strictEqual(ledger.events[0].state, 'online');
    assert.strictEqual(ledger.events[0].nodeUuid, 'node-1');
  });
});
