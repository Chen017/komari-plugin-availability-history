import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../komari-plugin.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('Plugin manifest', () => {
  it('declares Komari managed configuration so the admin Config button is shown', () => {
    assert.strictEqual(manifest.configuration?.type, 'managed');
    assert.ok(Array.isArray(manifest.configuration?.data));
    assert.ok(manifest.configuration.data.length > 0);

    const items = new Map(manifest.configuration.data.map((item) => [item.key, item]));
    assert.deepStrictEqual(
      [...items.keys()],
      ['offline_grace_seconds', 'retention_days', 'observer_heartbeat_seconds']
    );

    assert.deepStrictEqual(
      [...items.values()].map((item) => item.type),
      ['number', 'number', 'number']
    );
    assert.deepStrictEqual(
      [...items.values()].map((item) => item.default),
      [180, 90, 30]
    );

    for (const item of items.values()) {
      assert.equal(typeof item.name, 'string');
      assert.ok(item.name.length > 0);
    }
  });

  it('keeps manifest and package versions aligned', () => {
    assert.strictEqual(manifest.version, packageJson.version);
  });
});
