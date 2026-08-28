// One-off Exchange gateway smoke test — faithfully replicates
// ExchangeClient.post()/sendEmail()/sendSms()/sendWhatsapp() against the
// credentials currently in .env. Run: node scripts/test-exchange.mjs [toEmail]
import { readFileSync } from 'node:fs';

// --- load .env (simple KEY=VALUE parser; no external deps) ---
const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const url = env.EXCHANGE_API_URL;
const key = env.EXCHANGE_API_KEY;
const secret = env.EXCHANGE_API_SECRET;
const fromEmail = env.EXCHANGE_FROM_EMAIL || '';
const fromName = env.EXCHANGE_FROM_NAME || '';
const frontendUrl = env.FRONTEND_URL || '';
const timeoutMs = parseInt(env.EXCHANGE_TIMEOUT_MS ?? '15000', 10);

console.log('=== Exchange config (from .env) ===');
console.log('URL        :', url);
console.log('KEY        :', key);
console.log('SECRET     :', secret ? secret.slice(0, 3) + '***' : '(missing)');
console.log('FROM       :', `${fromName} <${fromEmail}>`);
console.log('configured :', !!(url && key && secret));
console.log('');

if (!(url && key && secret)) {
  console.error('ABORT: EXCHANGE_API_* not fully configured — real client would no-op.');
  process.exit(1);
}

const base = url.replace(/\/$/, '');
const endpoint = base.endsWith('/notifications') ? base : `${base}/notifications`;

async function post(notification, reqParams = {}) {
  const envelope = {
    data: {
      key,
      secret,
      peer_tenant_id: 'smoke-test',
      peer_branch_id: '',
      peer_tenant_info: '',
      peer_server_url: frontendUrl,
      peer_branch_info: '',
      notification_type: reqParams.notification_type ?? '',
      request_params: reqParams,
      data: [notification],
    },
  };
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
  return { httpStatus: res.status, ms, text, parsed };
}

const to = process.argv[2] || 'lokesh.kharkwal@kalnostic.com';

const emailNotification = {
  type: 'email',
  to,
  toName: 'Test Recipient',
  from: fromEmail,
  fromName,
  subject: Buffer.from(`Exchange smoke test — ${new Date().toISOString()}`, 'utf8').toString('base64'),
  body: Buffer.from(
    `<p>This is an automated Exchange gateway credential test from kalnostics-new.</p>` +
    `<p>If you received this, the new EXCHANGE_API_* credentials are working.</p>`,
    'utf8',
  ).toString('base64'),
  attachments: false,
};

console.log(`=== POST ${endpoint} ===`);
console.log(`Sending test EMAIL to: ${to}`);
try {
  const r = await post(emailNotification, { notification_type: 'smoke_test' });
  console.log(`HTTP ${r.httpStatus} in ${r.ms}ms`);
  console.log('Raw response:', r.text.slice(0, 1000));
  const idPresent = !!r.parsed && r.parsed.id != null;
  console.log('');
  console.log(idPresent
    ? `✅ ACCEPTED — response has id=${r.parsed.id} (isOk() === true). Credentials work.`
    : `❌ NOT ACCEPTED — no non-null "id" in response (isOk() === false). Gateway rejected or errored.`);
} catch (err) {
  console.error('❌ TRANSPORT ERROR (real client would log a warning and return null):');
  console.error('   ', err?.message || String(err));
  process.exit(2);
}
