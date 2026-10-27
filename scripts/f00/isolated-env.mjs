import { fileURLToPath } from 'node:url';
const systemKeys = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE'];
export function isolatedEnv(source = process.env, { postgres = false } = {}) {
  const env = Object.fromEntries(systemKeys.filter(k => source[k] !== undefined).map(k => [k, source[k]]));
  Object.assign(env, { NODE_ENV: 'test', CI: 'true', HTNQ_F00_ISOLATED: '1', DOTENV_CONFIG_PATH: fileURLToPath(new URL('./empty.env', import.meta.url)), DOTENV_CONFIG_QUIET: 'true', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/htnq_f00_unavailable', DISCORD_TOKEN: 'f00-synthetic-token-never-valid-on-discord', CHECKOUT_ENABLED: 'false', CHECKOUT_ALLOW_TEST: 'false', DOCUMENT_EMAIL_ENABLED: 'false', PAYMENT_REMINDERS_ENABLED: 'false', AUTOMATIC_INSTALMENTS_ENABLED: 'false', PAID_MEMBERSHIP_SYNC_ENABLED: 'false', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'build-verification-public-placeholder' });
  if (postgres) {
    let url;
    try { url = new URL(source.TEST_DATABASE_URL); } catch { throw new Error('F00 requires an explicit isolated TEST_DATABASE_URL for --postgres'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username !== 'test' || url.password !== 'test' || !/^\/(mentorship_test|htnq_f00_[a-z0-9_]+)$/.test(url.pathname) || url.search || url.hash) throw new Error('F00 refuses a database outside the explicit local disposable test profile');
    env.TEST_DATABASE_URL = url.href;
  }
  env.NODE_OPTIONS = '--import=' + new URL('./network-guard.mjs', import.meta.url).href;
  return env;
}
