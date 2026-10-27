import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedEnv } from './isolated-env.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const app = pkg.name === 'htnq-trading-checklist';
if (!app && pkg.name !== 'h4sth2-mentorship-bot') throw new Error('Unsupported F00 repository');
if (process.argv.slice(2).some(a => a !== '--postgres' && a !== '--baseline')) throw new Error('Usage: node scripts/f00/check.mjs [--postgres] [--baseline]');
if (app && process.argv.includes('--postgres')) throw new Error('The app does not need a database for baseline checks');
const baseline = process.argv.includes('--baseline');
const env = isolatedEnv(process.env, { postgres: process.argv.includes('--postgres') });
const stages = [ ['isolation controls', ['--test', 'scripts/f00/isolation.test.mjs']] ];
if (app) stages.push(['existing app tests', ['node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=2', 'tests/**/*.test.ts']], ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json', '--composite', 'false']], ['web build (no env files)', ['scripts/f00/build-web.mjs']]);
else stages.push(['bot build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']], ['bot tests', ['node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1', 'test/*.test.mjs', 'test/member-access/*.test.ts']]);
console.log('F00 isolated checks; Node ' + process.version + '; ' + (env.TEST_DATABASE_URL ? 'disposable local PostgreSQL' : app ? 'no database' : 'in-process PGlite; real PostgreSQL-only checks may skip') + '; ' + (baseline ? 'baseline' : 'candidate'));
const evidence = resolve(root, '.f00-evidence');
mkdirSync(evidence, { recursive: true });
const report = { schema_version: 1, repository: pkg.name, node: process.version, postgres: Boolean(env.TEST_DATABASE_URL), stages: [] };
for (const [name, args] of stages) {
  console.log('\nF00: ' + name);
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const logfile = name.replace(/[^a-z0-9]+/gi, '-') + '.log';
  writeFileSync(resolve(evidence, logfile), output);
  report.stages.push({ name, exit_code: result.status, logfile, error: result.error?.message });
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(output.split('\n').filter(l => /^# (tests|pass|fail|skipped|duration_ms)/.test(l) || /built in|error TS|Warning:/.test(l)).join('\n') || 'exit ' + result.status);
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) { console.error(output.slice(-6000)); process.exit(result.status ?? 1); }
}
