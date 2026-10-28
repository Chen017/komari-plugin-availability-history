import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { Ledger } from '../src/ledger.ts';

test('consecutive ledger appends read the recovery tail once and keep every event', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-performance-'));
  const originalRead = fs.readFileSync;
  const filename = path.join(directory, 'events.jsonl');
  let reads = 0;
  try {
    fs.writeFileSync(filename, '{"type":');
    const ledger = new Ledger(directory);
    ledger.init();
    fs.readFileSync = function (file, ...args) {
      if (file === filename) reads++;
      return originalRead.call(this, file, ...args);
    };
    syncBuiltinESMExports();
    for (let i = 0; i < 100; i++) {
      ledger.appendEvent({ schemaVersion: 1, type: 'node_state', nodeUuid: `node-${i}`, state: 'online', at: new Date().toISOString(), sessionId: 'test' });
    }
    assert.equal(reads, 1);
    const events = ledger.loadEvents();
    assert.equal(events.length, 100);
    assert.equal(events.at(-1).nodeUuid, 'node-99');
    ledger.compact(90);
    ledger.appendEvent({ schemaVersion: 1, type: 'observer_gap', from: '2026-10-28T01:00:00Z', to: '2026-10-28T02:00:00Z' });
    assert.equal(ledger.loadEvents().filter(event => event.type === 'observer_gap').length, 1);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
