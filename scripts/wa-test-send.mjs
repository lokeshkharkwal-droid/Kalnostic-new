// One-off diagnostic: send the aiSensy-approved WhatsApp template
// `send_report_as_attachment` directly through the Exchange gateway to a test
// number, exactly mirroring the envelope built by exchange.client.ts.
// Usage: node scripts/wa-test-send.mjs <phone> [templateId]

const PHONE = process.argv[2] || '919634824856';
const TEMPLATE_ID = process.argv[3] || 'send_report_as_attachment';

const URL = process.env.EXCHANGE_API_URL;
const KEY = process.env.EXCHANGE_API_KEY;
const SECRET = process.env.EXCHANGE_API_SECRET;
const SENDER = process.env.WA_SENDER_ID || ''; // relay may resolve server-side

// --- build a minimal, valid PDF with correct xref offsets ---------------------
function buildPdf() {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length 58>>\nstream\nBT /F1 18 Tf 20 100 Td (Test Lab Report PDF) Tj ET\nendstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

const pdfB64 = buildPdf().toString('base64');

// --- fill the template body just like communication.service fillTemplate -------
const vars = {
  pfn: 'Test Patient',
  order_number: 'ORD-TEST-001',
  user_name: 'Dr. Demo',
  date: '2026-09-01',
  time: '12:00 PM',
  web_title: 'Kalnostics',
};
const rawBody =
  'Dear {pfn},\n\nPatient report regarding order id{order_number} with {user_name} @ {date} on {time} is attached here.\n\nThanks,\n{web_title} Team';
let message = rawBody;
for (const [k, v] of Object.entries(vars)) message = message.split(`{${k}}`).join(v);

// aiSensy positional params, in template order
const templateParams = [
  vars.pfn,
  vars.order_number,
  vars.user_name,
  vars.date,
  vars.time,
  vars.web_title,
];

const notification = {
  type: 'whatsapp',
  to: PHONE,
  message,
  sms_template_id: TEMPLATE_ID,
  sms_sender_id: SENDER,
  sms_type: '',
  template_category: 'utility',
  template_params: templateParams,
  attachments: [{ data: pdfB64, name: 'test-lab-report.pdf', type: 'application/pdf' }],
  context_name: vars.pfn,
};

const reqParams = {
  notification_type: 'console_lab_report_as_attachment',
  context_id: 'wa-test',
  context_type: 'diagnostic',
};

const envelope = {
  data: {
    key: KEY,
    secret: SECRET,
    peer_tenant_id: 'diagnostic',
    peer_branch_id: '',
    peer_tenant_info: '',
    peer_server_url: process.env.FRONTEND_URL || '',
    peer_branch_info: '',
    notification_type: reqParams.notification_type,
    request_params: reqParams,
    data: [notification],
  },
};

console.log('POST', URL);
console.log('template_id:', TEMPLATE_ID, '| to:', PHONE, '| params:', JSON.stringify(templateParams));

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(envelope),
  signal: AbortSignal.timeout(30000),
});
const text = await res.text();
console.log('HTTP', res.status);
console.log('RESPONSE:', text);
