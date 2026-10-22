import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Ledger } from '../src/ledger.ts';
import { calculateAvailabilitySummary } from '../src/summary.ts';

test('recovery gap survives a truncated append and prevents invented uptime', () => {
  const directory = fs.mkdtempSync(path.resolve('.test-recovery-'));
  try {
    const from = new Date(Date.now() - 3600000).toISOString();
    fs.writeFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ type: 'node_state', nodeUuid: 'n', state: 'online', at: from }) + '\n{"type":');
    fs.writeFileSync(path.join(directory, 'observer-state.json'), JSON.stringify({ lastHeartbeatAt: from }));
    const ledger = new Ledger(directory);
    ledger.init();
    const events = ledger.loadEvents();
    assert.equal(events.filter(event => event.type === 'observer_gap').length, 1);
    assert.equal(calculateAvailabilitySummary(events, ['n'], new Date(from), new Date()).nodes[0].onlineSeconds, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unobserved time is neither a confirmed outage nor an outage continuation', () => {
  const events = [
    { type: 'node_state', nodeUuid: 'n', state: 'offline', at: '2026-10-20T00:00:00Z' },
    { type: 'observer_gap', from: '2026-10-20T01:00:00Z', to: '2026-10-20T02:00:00Z' },
  ];
  assert.equal(calculateAvailabilitySummary(events, ['n'], new Date('2026-10-21'), new Date('2026-10-22')).nodes[0].outageCount, 0);
});
