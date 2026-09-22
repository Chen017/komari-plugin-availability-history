import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateAvailabilitySummary } from '../src/summary.ts';

describe('Availability summary calculation tests', () => {
  it('historical outage remains < 100% after reconnect', () => {
    const windowStart = new Date('2026-09-21T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T00:00:00.000Z'); // 24h = 86400s

    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'zouter',
        state: 'online',
        at: '2026-09-21T00:00:00.000Z',
        sessionId: 's1',
      },
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'zouter',
        state: 'offline',
        at: '2026-09-21T12:00:00.000Z', // 12h offline
        sessionId: 's1',
      },
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'zouter',
        state: 'online',
        at: '2026-09-21T18:00:00.000Z', // 6h offline, reconnected
        sessionId: 's1',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['zouter'], windowStart, windowEnd);
    assert.strictEqual(res.nodes.length, 1);
    const node = res.nodes[0];

    assert.strictEqual(node.currentState, 'online');
    assert.strictEqual(node.onlineSeconds, 18 * 3600); // 12h + 6h = 18h
    assert.strictEqual(node.offlineSeconds, 6 * 3600);  // 6h
    assert.strictEqual(node.observableSeconds, 24 * 3600);
    assert.strictEqual(node.uptimeRatio, 18 / 24); // 0.75
    assert.strictEqual(node.outageCount, 1);
  });

  it('excludes observer gap from denominator and prevents old state from crossing gap', () => {
    const windowStart = new Date('2026-09-22T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T10:00:00.000Z'); // 10h = 36000s

    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-1',
        state: 'online',
        at: '2026-09-22T00:00:00.000Z',
        sessionId: 's1',
      },
      // Controller restart from 02:00 to 04:00 (2 hours gap)
      {
        schemaVersion: 1,
        type: 'observer_gap',
        from: '2026-09-22T02:00:00.000Z',
        to: '2026-09-22T04:00:00.000Z',
      },
      // Re-anchored at 05:00 (1 hour unobserved post-gap)
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-1',
        state: 'online',
        at: '2026-09-22T05:00:00.000Z',
        sessionId: 's2',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['node-1'], windowStart, windowEnd);
    const node = res.nodes[0];

    // Online from 00:00 to 02:00 (2h)
    // 02:00 to 04:00 is observer_gap -> UNOBSERVED
    // 04:00 to 05:00 has no re-anchor yet -> UNOBSERVED
    // 05:00 to 10:00 is online (5h)
    // Total online: 7h (25200s), offline: 0s.
    assert.strictEqual(node.onlineSeconds, 7 * 3600);
    assert.strictEqual(node.offlineSeconds, 0);
    assert.strictEqual(node.uptimeRatio, 1);
    assert.strictEqual(res.observerCoverage.unobservedSeconds, 2 * 3600);
    assert.strictEqual(res.observerCoverage.observableSeconds, 8 * 3600);
  });

  it('formats partial history coverage accurately without fabricating 30 days', () => {
    const windowStart = new Date('2026-08-23T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T00:00:00.000Z'); // 30 days

    // Only tracked since 3 days ago (2026-09-19)
    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-fresh',
        state: 'online',
        at: '2026-09-19T00:00:00.000Z',
        sessionId: 's1',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['node-fresh'], windowStart, windowEnd);
    const node = res.nodes[0];

    // Observable is exactly 3 days (259200s) out of 30 days (2592000s)
    assert.strictEqual(node.observableSeconds, 3 * 86400);
    assert.strictEqual(node.coverageRatio, 0.1); // 3 / 30 = 0.1
    assert.strictEqual(node.uptimeRatio, 1);
  });

  it('correctly uses pre-window anchor event to establish state at window start', () => {
    const windowStart = new Date('2026-09-22T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T10:00:00.000Z');

    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-old',
        state: 'online',
        at: '2026-09-20T00:00:00.000Z', // 2 days before window
        sessionId: 's0',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['node-old'], windowStart, windowEnd);
    const node = res.nodes[0];

    assert.strictEqual(node.onlineSeconds, 10 * 3600);
    assert.strictEqual(node.offlineSeconds, 0);
    assert.strictEqual(node.uptimeRatio, 1);
    assert.strictEqual(node.coverageRatio, 1);
  });

  it('Test F — observer gap causes currentState to become unknown when not re-anchored', () => {
    const windowStart = new Date('2026-09-22T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T10:00:00.000Z');

    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-gap',
        state: 'online',
        at: '2026-09-22T00:00:00.000Z',
        sessionId: 's1',
      },
      {
        schemaVersion: 1,
        type: 'observer_gap',
        from: '2026-09-22T02:00:00.000Z',
        to: '2026-09-22T04:00:00.000Z',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['node-gap'], windowStart, windowEnd);
    assert.strictEqual(res.nodes[0].currentState, 'unknown');
  });

  it('Test G — observer gap followed by re-anchor restores currentState', () => {
    const windowStart = new Date('2026-09-22T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T10:00:00.000Z');

    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-reanchor',
        state: 'online',
        at: '2026-09-22T00:00:00.000Z',
        sessionId: 's1',
      },
      {
        schemaVersion: 1,
        type: 'observer_gap',
        from: '2026-09-22T02:00:00.000Z',
        to: '2026-09-22T04:00:00.000Z',
      },
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-reanchor',
        state: 'online',
        at: '2026-09-22T05:00:00.000Z',
        sessionId: 's2',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['node-reanchor'], windowStart, windowEnd);
    assert.strictEqual(res.nodes[0].currentState, 'online');
  });

  it('Test H — outage overlapping window start counts in outageCount and offlineSeconds', () => {
    const windowStart = new Date('2026-09-22T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T10:00:00.000Z');

    const events = [
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-overlap',
        state: 'offline',
        at: '2026-09-21T23:50:00.000Z',
        sessionId: 's1',
      },
      {
        schemaVersion: 1,
        type: 'node_state',
        nodeUuid: 'node-overlap',
        state: 'online',
        at: '2026-09-22T00:20:00.000Z',
        sessionId: 's1',
      },
    ];

    const res = calculateAvailabilitySummary(events, ['node-overlap'], windowStart, windowEnd);
    const node = res.nodes[0];

    assert.strictEqual(node.outageCount, 1);
    assert.strictEqual(node.offlineSeconds, 20 * 60);
  });

  it('Test I — zero observable data yields uptimeRatio = null', () => {
    const windowStart = new Date('2026-09-22T00:00:00.000Z');
    const windowEnd = new Date('2026-09-22T10:00:00.000Z');

    const res = calculateAvailabilitySummary([], ['node-unknown'], windowStart, windowEnd);
    const node = res.nodes[0];

    assert.strictEqual(node.observableSeconds, 0);
    assert.strictEqual(node.uptimeRatio, null);
  });
});
