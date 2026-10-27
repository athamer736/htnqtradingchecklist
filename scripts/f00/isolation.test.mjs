import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { isolatedEnv } from './isolated-env.mjs';
test('operator credentials and node injection do not enter a test child', () => {
  const env = isolatedEnv({ PATH: '/synthetic', DATABASE_URL: 'postgresql://production.invalid/live', STRIPE_SECRET_KEY: 'operator-secret', DISCORD_TOKEN: 'operator-token', VITE_PRIVATE_KEY: 'operator-value', NODE_OPTIONS: '--require=unexpected', TEST_DATABASE_URL: 'postgresql://production.invalid/live' });
  assert.equal(env.STRIPE_SECRET_KEY, undefined); assert.equal(env.VITE_PRIVATE_KEY, undefined); assert.equal(env.TEST_DATABASE_URL, undefined);
  assert.equal(env.DATABASE_URL, 'postgresql://test:test@127.0.0.1:1/htnq_f00_unavailable');
  assert.ok(!env.NODE_OPTIONS.includes('unexpected')); assert.match(env.DOTENV_CONFIG_PATH, /empty\.env$/);
});
test('PostgreSQL requires the deliberately disposable local profile', () => {
  for (const value of [undefined, 'postgresql://test:test@production.invalid/mentorship_test', 'postgresql://owner:secret@127.0.0.1/mentorship_test', 'postgresql://test:test@127.0.0.1/production', 'postgresql://test:test@127.0.0.1/mentorship_test?options=unsafe']) assert.throws(() => isolatedEnv({ TEST_DATABASE_URL: value }, { postgres: true }));
  assert.match(isolatedEnv({ TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/mentorship_test' }, { postgres: true }).TEST_DATABASE_URL, /mentorship_test/);
});
test('test networking blocks provider fetches and raw external sockets before connection', async () => {
  await assert.rejects(fetch('https://example.invalid/should-never-leave-machine'), /F00 isolation/);
  assert.throws(() => createConnection({ host: 'example.invalid', port: 443 }), /F00 isolation/);
});

import { createServer } from 'node:http';
test('loopback mock remains reachable with isolation enabled', async () => {
  const server = createServer((req, res) => res.end('synthetic'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port);
    assert.equal(await response.text(), 'synthetic');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
