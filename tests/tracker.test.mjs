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
  it('handles normal outage: online -> disconnect -> grace expires -> reconnect', async () => {
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 0.05, // 50ms for testing
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

    // Wait for grace to expire
    await new Promise((r) => setTimeout(r, 80));

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

  it('suppresses short flaps under grace period', async () => {
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 0.1, // 100ms
      ledger,
    });

    tracker.ensureConnectionKnown('node-1', 1);
    assert.strictEqual(ledger.events.length, 1);

    // Close
    tracker.handleConnectionClose('node-1', 1);

    // Reconnect after 30ms (< 100ms grace)
    await new Promise((r) => setTimeout(r, 30));
    tracker.ensureConnectionKnown('node-1', 2);

    // Wait past the original 100ms
    await new Promise((r) => setTimeout(r, 100));

    // No offline event should ever be emitted
    assert.strictEqual(ledger.events.length, 1);
    assert.strictEqual(ledger.events[0].state, 'online');
  });

  it('keeps node online if one of multiple connections closes', async () => {
    const ledger = new MockLedger();
    const tracker = new ConnectionTracker({
      offlineGraceSeconds: 0.05,
      ledger,
    });

    tracker.ensureConnectionKnown('node-1', 1);
    tracker.ensureConnectionKnown('node-1', 2);

    assert.strictEqual(ledger.events.length, 1); // Only 1 online event

    // Close connection 1
    tracker.handleConnectionClose('node-1', 1);
    await new Promise((r) => setTimeout(r, 70));

    // Still online because connection 2 remains
    assert.strictEqual(ledger.events.length, 1);
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
