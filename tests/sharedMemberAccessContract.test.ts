import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMentorshipAccessResponse, MENTORSHIP_API_PATH, MENTORSHIP_API_SCHEMA_VERSION } from '../supabase/functions/_shared/mentorshipApi.ts';
const fixture = JSON.parse(readFileSync(new URL('../docs/contracts/member-access-v1.fixtures.json', import.meta.url), 'utf8'));
describe('shared member-access v1 consumer contract', () => {
  it('uses the registered schema and path', () => { assert.equal(MENTORSHIP_API_PATH, '/api/v1/member-access'); assert.equal(MENTORSHIP_API_SCHEMA_VERSION, fixture.schema_version); });
  for (const item of fixture.cases) it(item.label, () => { const result = parseMentorshipAccessResponse(item.expected, item.request.discord_id); assert.equal(result.kind, item.expected.access); if ('body' in result) assert.deepEqual(result.body, item.expected); });
  for (const invalid of fixture.invalid_responses) it('rejects ' + invalid.label, () => { assert.deepEqual(parseMentorshipAccessResponse(invalid.response, invalid.expected_discord_id), { kind: 'unavailable', error: invalid.expected_error }); });
});
