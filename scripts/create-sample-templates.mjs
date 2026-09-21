// @ts-nocheck
/**
 * Create/refresh "SAMPLE" PDF print templates in a tenant via the running API,
 * one per wired print type, each exercising the NEW/updated template tags:
 *   • {patient_age}  → full "Years, Months, Days"
 *   • {collected_at} → date + time (labels)
 *   • {department_name} (labels)
 *   • report sample_collected_date / sample_received_date (already date+time)
 *
 * Idempotent: a template with the same name is updated in place, else created.
 * Also renders each CLASSIC template via /:id/generate with sample data to prove
 * it is valid and saved. (lab_all_report uses the Latte engine and is only
 * verifiable end-to-end through the app's "All Reports" print, so it is created
 * but not self-rendered.)
 *
 * Usage (from kalnostics-new/):
 *   node scripts/create-sample-templates.mjs
 * Env overrides: API_BASE, LOGIN_ID, LOGIN_PW
 */

const BASE = process.env.API_BASE ?? 'http://137.184.177.195:8080/api/v1';
const LOGIN_ID = process.env.LOGIN_ID ?? 'priya@email.com';
const LOGIN_PW = process.env.LOGIN_PW ?? 'Password@123';

const CSS = `
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#1f2937;margin:0}
h2{margin:0 0 4px;font-size:15pt}h4{margin:10px 0 4px}
.muted{color:#6b7280;font-size:9pt}
table{width:100%;border-collapse:collapse;font-size:9pt;margin:6px 0}
th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#f1f5f9}
.new{background:#fff7ed;border:1px solid #fb923c;border-radius:6px;padding:8px 10px;margin:8px 0}
.new b{color:#c2410c}
.label{display:inline-block;border:2px dashed #334155;border-radius:8px;padding:12px;margin:6px;width:320px;vertical-align:top}
.barcode{font-family:'Courier New',monospace;font-size:20pt;letter-spacing:3px;text-align:center;margin:4px 0}
.sign{display:inline-block;margin-right:28px;text-align:center}
`.trim();

const NAME = (label) => `SAMPLE ✦ ${label} (new tags)`;

const PATIENT_LINE =
  '<div>Patient: <b>{patient_name}</b> ({patient_gender}) &middot; UHID {patient_um_id}</div>';

/** Highlight box that makes the new tags obvious in the rendered PDF. */
const AGE_BOX =
  '<div class="new"><b>NEW &mdash; Full Age (Years, Months, Days):</b> {patient_age}</div>';

/** Highlight box for the new combined Order Date &amp; Time tag. */
const ODT_BOX =
  '<div class="new"><b>NEW &mdash; Order Date &amp; Time:</b> {order_date_time}</div>';

const ITEMS_TABLE = `<table><thead><tr><th>#</th><th>Item</th><th>Code</th><th>Type</th><th>Price</th><th>Disc</th></tr></thead>
<tbody>{{#each items}}<tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{type}</td><td>{price}</td><td>{discount}</td></tr>{{/each}}</tbody></table>`;

/** Every template we manage. `render` = sample GeneratePdfDto for the self-test. */
const TEMPLATES = [
  {
    type: 'order_print',
    label: 'Order Slip',
    body: `<h2>{branch_name} &mdash; Order Slip</h2>
<div class="muted">Order {order_code} &middot; Bill {bill_id} &middot; {order_date} {order_time} &middot; {status}</div>
${AGE_BOX}${PATIENT_LINE}
<div class="muted">Mobile {patient_mobile} &middot; DOB {patient_dob} &middot; Referred By {referred_by} &middot; Panel {referral_panel}</div>
${ITEMS_TABLE}`,
    render: { sections: { items: [{ sr_no: 1, name: 'CBC', code: 'T001', type: 'Test', price: 250, discount: 0 }] } },
  },
  {
    type: 'bill_print',
    label: 'Patient Bill',
    body: `<h2>{branch_name} &mdash; Patient Bill</h2>
<div class="muted">Bill {bill_id} &middot; Order {order_code} &middot; Bill generated: {bill_date_time} &middot; {status} ({payment_status})</div>
${ODT_BOX}${AGE_BOX}${PATIENT_LINE}
${ITEMS_TABLE}
<div>Gross {gross_amount} &middot; Disc {discount_amount} &middot; Net <b>{net_amount}</b> &middot; Paid {paid_amount} &middot; Balance {balance_amount}</div>
<div class="muted">In words: {total_amount_in_words}</div>
<h4>Payments (date + time)</h4>
<table><thead><tr><th>Date &amp; Time</th><th>Mode</th><th>Reference</th><th>Amount</th></tr></thead>
<tbody>{{#each payments}}<tr><td>{date}</td><td>{mode}</td><td>{reference}</td><td>{amount}</td></tr>{{/each}}</tbody></table>`,
    render: {
      variables: { order_date_time: '21/09/2026 01:30 PM' },
      sections: {
        items: [{ sr_no: 1, name: 'CBC', code: 'T001', type: 'Test', price: 250, discount: 0 }],
        payments: [{ date: '21/09/2026, 01:30 PM', mode: 'CASH', reference: '-', amount: 250 }],
      },
    },
  },
  {
    type: 'accounts_biling',
    label: 'Accounts Billing',
    body: `<h2>{branch_name} &mdash; Accounts Billing</h2>
<div class="muted">Bill {bill_id} &middot; Order {order_code} &middot; {status} ({payment_status})</div>
${AGE_BOX}${PATIENT_LINE}
<div class="muted">Panel {panel_name} ({panel_code}) &middot; {panel_accounts_person} &middot; {panel_accounts_email} &middot; {panel_accounts_mobile}</div>
${ITEMS_TABLE}
<div>Gross {gross_amount} &middot; Disc {discount_amount} &middot; Net <b>{net_amount}</b></div>`,
    render: { sections: { items: [{ sr_no: 1, name: 'CBC', code: 'T001', type: 'Test', price: 250, discount: 0 }] } },
  },
  {
    type: 'trf_print',
    label: 'Test Requisition Form',
    body: `<h2>{branch_name} &mdash; Test Requisition Form</h2>
<div class="muted">TRF {trf_ref} &middot; Order {order_code} &middot; {order_date}</div>
${ODT_BOX}${AGE_BOX}${PATIENT_LINE}
<div class="muted">Referred By {referred_by} &middot; Panel {referral_panel}</div>
<table><thead><tr><th>#</th><th>Test / Service</th><th>Code</th><th>Status</th></tr></thead>
<tbody>{{#each tests}}<tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{status}</td></tr>{{/each}}</tbody></table>
<div class="muted">Clinical Notes: {clinical_notes}</div>`,
    render: { variables: { order_date_time: '21/09/2026 01:30 PM' }, sections: { tests: [{ sr_no: 1, name: 'CBC', code: 'T001', status: 'REQUESTED' }] } },
  },
  {
    type: 'lab_quotation_print',
    label: 'Lab Quotation',
    body: `<h2>{branch_name} &mdash; Quotation</h2>
<div class="muted">Quote {quote_id} &middot; {quote_date} &middot; Valid Till {valid_till} &middot; {status}</div>
${AGE_BOX}${PATIENT_LINE}
<table><thead><tr><th>#</th><th>Service</th><th>Code</th><th>Type</th><th>Price</th></tr></thead>
<tbody>{{#each items}}<tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{type}</td><td>{price}</td></tr>{{/each}}</tbody></table>
<div>Gross {gross_amount} &middot; Disc {discount_amount} &middot; Net <b>{net_amount}</b></div>`,
    render: { sections: { items: [{ sr_no: 1, name: 'CBC', code: 'T001', type: 'Test', price: 250 }] } },
  },
  {
    type: 'order_barcode_print',
    label: 'Order Barcode',
    body: `<div class="label">
<div class="barcode">*{barcode}*</div>
${AGE_BOX}
<div><b>{patient_name}</b> ({patient_gender}) &middot; UHID {patient_um_id}</div>
<div>{order_code} &middot; {order_date}</div>
<div class="muted">Tests: {test_names}</div>
</div>`,
    render: { variables: {} },
  },
  {
    type: 'lab_report',
    label: 'Lab Test Report',
    body: `<h2>{branch_name} &mdash; Laboratory Report</h2>
<div class="muted">Order {order_code} &middot; {order_date_time} &middot; Ext {external_order_id}</div>
<div class="new"><b>NEW &mdash; Full Age:</b> {patient_age}<br/>
<b>Collection date + time:</b> Collected {sample_collected_date} &middot; Received {sample_received_date}</div>
${PATIENT_LINE}
<div>Test: <b>{test_name}</b> &middot; Status {report_status} &middot; Sample {sample_type} ({sample_source_label})</div>
<table><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Method</th><th>Reference</th></tr></thead>
<tbody>{{#each results}}<tr><td>{parameter_name}</td><td>{observed1}</td><td>{unit}</td><td>{methodology}</td><td>{reference_display}</td></tr>{{/each}}</tbody></table>
<div class="muted">Interpretation: {interpretation}</div>`,
    footer: `<signing_authority_tag><div class="sign"><img src="{signatureImage}" style="max-height:44px"/><div><b>{name}</b></div><div class="muted">{designation}</div><div class="muted">{report_approved_by_certifications}</div></div></signing_authority_tag>`,
    render: {
      sections: { results: [{ parameter_name: 'Haemoglobin', observed1: '13.5', unit: 'g/dL', methodology: 'Photometry', reference_display: '13-17' }] },
      signatories: [{ name: 'Dr. A. Rao', designation: 'MD Pathology', certifications: 'NABL Authorized' }],
    },
  },
  {
    type: 'lab_panel',
    label: 'Lab Panel Report',
    body: `<h2>{branch_name} &mdash; Panel Report</h2>
<div class="muted">Order {order_code} &middot; {order_date_time}</div>
<div class="new"><b>NEW &mdash; Full Age:</b> {patient_age}<br/>
<b>Collection date + time:</b> Collected {sample_collected_date} &middot; Received {sample_received_date}</div>
${PATIENT_LINE}
<div>Panel: <b>{test_name}</b> &middot; Status {report_status}</div>
<table><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Reference</th></tr></thead>
<tbody>{{#each results}}<tr><td>{parameter_name}</td><td>{observed1}</td><td>{unit}</td><td>{reference_display}</td></tr>{{/each}}</tbody></table>`,
    footer: `<signing_authority_tag><div class="sign"><b>{name}</b><div class="muted">{designation}</div></div></signing_authority_tag>`,
    render: {
      sections: { results: [{ parameter_name: 'Glucose', observed1: '92', unit: 'mg/dL', reference_display: '70-100' }] },
      signatories: [{ name: 'Dr. A. Rao', designation: 'MD Pathology' }],
    },
  },
  {
    // Latte engine — different context shape (header_fields + report_tests.tests[]).
    type: 'lab_all_report',
    label: 'All Reports',
    body: `<div class="report-page-header">
<h2>Consolidated Report</h2>
<div>Patient: <b>{$header_fields->patient->full_name}</b> ({$header_fields->client_gender}) &middot; UHID {$header_fields->client_uhid}</div>
<div class="new"><b>NEW &mdash; Full Age:</b> {$header_fields->client_age}</div>
<div class="muted">Phone {$header_fields->client_phone} &middot; {$header_fields->order_date_time} &middot; Ref By {$header_fields->refer_by_name} &middot; Panel {$header_fields->referring_panel_name}</div>
</div>
{foreach $report_tests->tests as $t}
<div style="margin-top:12px">
<div class="muted">Collected {$t->sample_collected_date} &middot; Received {$t->sample_received_date} &middot; Prepared {$t->report_prepared_on}</div>
{$t->body_html|noescape}
</div>
{/foreach}`,
    render: null, // Latte context can't be supplied through /:id/generate — test via the app.
  },
  {
    // Latte engine — same context + renderer as lab_all_report (wired via
    // printAllForOrder). This is the patient-facing "All Reports" variant.
    type: 'patient_lab_all_report',
    label: 'Patient Lab All Reports',
    body: `<div class="report-page-header">
<h2>Patient Report (All Investigations)</h2>
<div>Patient: <b>{$header_fields->patient->full_name}</b> ({$header_fields->client_gender}) &middot; UHID {$header_fields->client_uhid}</div>
<div class="new"><b>NEW &mdash; Full Age:</b> {$header_fields->client_age}<br/><b>Order Date &amp; Time:</b> {$header_fields->order_date_time}</div>
<div class="muted">Phone {$header_fields->client_phone} &middot; Ref By {$header_fields->refer_by_name} &middot; Panel {$header_fields->referring_panel_name}</div>
</div>
{foreach $report_tests->tests as $t}
<div style="margin-top:12px">
<div class="muted">Collected {$t->sample_collected_date} &middot; Received {$t->sample_received_date} &middot; Prepared {$t->report_prepared_on}</div>
{$t->body_html|noescape}
</div>
{/foreach}`,
    render: null, // Latte context can't be supplied through /:id/generate — test via the app.
  },
  {
    type: 'order_label_print',
    label: 'Barcode Label',
    body: `<div class="label">
<div class="barcode">*{barcode}*</div>
<div class="new"><b>NEW &mdash; Full Age:</b> {patient_age}<br/><b>Department:</b> {department_name}<br/><b>Collected (date+time):</b> {collected_at}</div>
<div><b>{patient_name}</b> ({patient_gender}) &middot; UHID {patient_um_id}</div>
<div>{order_code} / {accession_no}</div>
<div class="muted">{sample_type} &middot; {container_type} &middot; {priority} &middot; Tests: {test_names}</div>
</div>`,
    render: {
      variables: {
        barcode: 'BC-000123', patient_age: '25 Years, 4 Months, 12 Days', department_name: 'Biochemistry, Hematology',
        collected_at: '21/09/2026 01:30 PM', patient_name: 'Ramesh Kumar', patient_gender: 'MALE',
        patient_um_id: 'UM-100', order_code: 'ORD-9', accession_no: 'ACC-9', sample_type: 'Serum',
        container_type: 'SST', priority: 'ROUTINE', test_names: 'CBC, LFT',
      },
    },
  },
  {
    type: 'multiple_order_label_print',
    label: 'Multiple Barcode Labels',
    body: `{{#each labels}}<div class="label">
<div class="barcode">*{barcode}*</div>
<div class="new"><b>Full Age:</b> {patient_age} &middot; <b>Dept:</b> {department_name}<br/><b>Collected:</b> {collected_at}</div>
<div><b>{patient_name}</b> ({patient_gender}) &middot; UHID {patient_um_id}</div>
<div>{order_code} / {accession_no}</div>
<div class="muted">{sample_type} &middot; Tests: {test_names}</div>
</div>{{/each}}`,
    render: {
      sections: {
        labels: [
          { barcode: 'BC-000123', patient_age: '25 Years, 4 Months, 12 Days', department_name: 'Biochemistry', collected_at: '21/09/2026 01:30 PM', patient_name: 'Ramesh Kumar', patient_gender: 'MALE', patient_um_id: 'UM-100', order_code: 'ORD-9', accession_no: 'ACC-9', sample_type: 'Serum', test_names: 'CBC' },
          { barcode: 'BC-000124', patient_age: '3 Years, 0 Months, 5 Days', department_name: 'Hematology', collected_at: '21/09/2026 02:05 PM', patient_name: 'Baby Sita', patient_gender: 'FEMALE', patient_um_id: 'UM-101', order_code: 'ORD-9', accession_no: 'ACC-10', sample_type: 'EDTA', test_names: 'CBC' },
        ],
      },
    },
  },
];

// Labels/barcodes render on a normal A4 page (easy to read while verifying tags).
function metaFor(t) {
  return {
    default_font: 'helvetica',
    custom_css: CSS,
    header_html: t.header ?? '',
    body_html: t.body,
    footer_html: t.footer ?? '',
  };
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/pdf')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, pdfBytes: buf.length };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function login() {
  const r = await api('/auth/login', { method: 'POST', body: { identifier: LOGIN_ID, password: LOGIN_PW } });
  if (!r.ok) throw new Error(`Login failed (${r.status}): ${JSON.stringify(r.json)}`);
  return r.json.data.accessToken;
}

async function findByExactName(token, type, name) {
  const r = await api(`/pdf-report-templates?type=${encodeURIComponent(type)}&limit=100`, { token });
  const list = r.json?.data ?? [];
  return list.find((t) => t.name === name) ?? null;
}

async function main() {
  const token = await login();
  console.log(`Logged in as ${LOGIN_ID}\n`);

  // Clean up the earlier permission smoke-test, if present.
  const smoke = await findByExactName(token, 'order_label_print', 'ZZ_PERM_SMOKE_TEST');
  if (smoke) {
    await api(`/pdf-report-templates/${smoke.id}`, { method: 'DELETE', token });
    console.log('Removed leftover ZZ_PERM_SMOKE_TEST\n');
  }

  const summary = [];
  for (const t of TEMPLATES) {
    const name = NAME(t.label);
    const meta = metaFor(t);
    let id, action;
    const existing = await findByExactName(token, t.type, name);
    if (existing) {
      const r = await api(`/pdf-report-templates/${existing.id}`, { method: 'PATCH', token, body: { name, isActive: true, meta } });
      if (!r.ok) { summary.push({ type: t.type, name, status: `UPDATE FAILED ${r.status}: ${JSON.stringify(r.json?.error ?? r.json)}` }); continue; }
      id = existing.id; action = 'updated';
    } else {
      const r = await api('/pdf-report-templates', { method: 'POST', token, body: { type: t.type, name, isActive: true, meta } });
      if (!r.ok) { summary.push({ type: t.type, name, status: `CREATE FAILED ${r.status}: ${JSON.stringify(r.json?.error ?? r.json)}` }); continue; }
      id = r.json.data.id; action = 'created';
    }

    let render = 'skipped (Latte / app-only)';
    if (t.render) {
      const rr = await api(`/pdf-report-templates/${id}/generate`, { method: 'POST', token, body: t.render });
      render = rr.ok && rr.pdfBytes ? `OK (${rr.pdfBytes} bytes)` : `FAILED ${rr.status}: ${JSON.stringify(rr.json?.error ?? rr.json)}`;
    }
    summary.push({ type: t.type, id, action, render, name });
  }

  console.log('=== Sample templates ===');
  for (const s of summary) {
    console.log(`\n• ${s.name}`);
    console.log(`  type:   ${s.type}`);
    if (s.id) console.log(`  id:     ${s.id}  (${s.action})`);
    console.log(`  render: ${s.render ?? s.status}`);
    if (s.status && !s.id) console.log(`  ERROR:  ${s.status}`);
  }
  console.log('\nDone. Select these in the Print picker (they are named "SAMPLE ✦ …").');
}

main().catch((e) => { console.error(e); process.exit(1); });
