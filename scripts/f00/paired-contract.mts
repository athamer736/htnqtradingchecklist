// Run from the app through the isolated environment, with an explicit bot checkout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { fetchMentorshipAccess } from '../../supabase/functions/_shared/mentorshipApi.ts';
const botRoot = process.argv[2];
if (!botRoot || process.env.HTNQ_F00_ISOLATED !== '1') throw new Error('Use check-paired.mjs with an explicit bot checkout');
const fixtureUrl = new URL('../../docs/contracts/member-access-v1.fixtures.json', import.meta.url);
const bytes = readFileSync(fixtureUrl);
assert.deepEqual(readFileSync(resolve(botRoot, 'docs/contracts/member-access-v1.fixtures.json')), bytes, 'Shared fixtures diverged');
assert.deepEqual(readFileSync(resolve(botRoot, 'docs/contracts/register.md')), readFileSync(new URL('../../docs/contracts/register.md', import.meta.url)), 'Contract registers diverged');
assert.equal(JSON.parse(readFileSync(resolve(botRoot, 'package.json'), 'utf8')).name, 'h4sth2-mentorship-bot');
const fixture = JSON.parse(bytes.toString('utf8'));
const { createMemberAccessHandler } = await import(pathToFileURL(resolve(botRoot, 'src/member-access/handler.ts')).href);
const { makeCredential } = await import(pathToFileURL(resolve(botRoot, 'src/member-access/auth.ts')).href);
const { DEFAULTS } = await import(pathToFileURL(resolve(botRoot, 'src/member-access/config.ts')).href);
const byId = new Map(fixture.cases.map((item: any) => [item.request.discord_id, item]));
const token = 'f00-paired-synthetic-token-0123456789abcdef';
const logs: unknown[] = [];
const handler = createMemberAccessHandler({ config: { ...DEFAULTS, credentials: [makeCredential('synthetic', token)] }, now: () => new Date(fixture.checked_at), records: { getMemberFacts: async (id: string) => (byId.get(id) as any)?.member ?? null, getStaffRecord: async (id: string) => (byId.get(id) as any)?.staff ?? null, hasStaffRole: async (id: string) => (byId.get(id) as any)?.hasStaffRole ?? false }, logger: { info: (...v: unknown[]) => logs.push(v), warn: (...v: unknown[]) => logs.push(v) } });
const server = createServer((req, res) => void handler(req, res));
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
try {
  for (const item of fixture.cases) {
    const response = await fetchMentorshipAccess({ baseUrl, token, discordId: item.request.discord_id, allowLocalHttp: true, retries: 0 });
    assert.equal(response.kind, item.expected.access, item.label);
    assert.ok('body' in response, item.label);
    if ('body' in response) assert.deepEqual(response.body, item.expected, item.label);
  }
  const wrong = await fetchMentorshipAccess({ baseUrl, token: 'wrong-synthetic-token-0123456789abcdef', discordId: fixture.cases[0].request.discord_id, allowLocalHttp: true, retries: 0 });
  assert.equal(wrong.kind, 'misconfigured');
  const text = JSON.stringify(logs);
  assert.ok(!text.includes(token) && !text.includes('Ada Example') && !text.includes('Staff Example'));
  console.log('PASS: actual app client -> actual bot handler over loopback; ' + fixture.cases.length + ' shared decisions, denied-name privacy, wrong-token rejection, redacted logs and identical registers/fixtures. No bot worker, provider API or real database was used.');
} finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
