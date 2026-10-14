// @ts-nocheck
/**
 * Seed ONE sample `lab_report` print template that exercises BOTH File+ attachment
 * tags, created in a tenant via the running API (logs in as a business user):
 *   • {test_file_attachment}                 → the upload drawn INLINE (PDF <embed> / image <img>)
 *   • {test_file_attachment_without_header}  → the upload APPENDED as extra pages at the
 *                                              end of the PDF (no header/footer)
 *
 * Idempotent: a `lab_report` template with the same name is updated in place, else
 * created. After upserting it also renders the template via /:id/generate with a
 * sample attachment URL so the self-test PDF actually demonstrates both tags
 * (inline embed + appended pages). If the sample URL isn't reachable from the
 * server, the inline tag prints an "Attached file" link and the append tag draws
 * a "could not be included" note page — both valid, and the template still saves.
 *
 * Usage (from kalnostics-new/):
 *   node scripts/create-attachment-sample-template.mjs
 * Env overrides: API_BASE, LOGIN_ID, LOGIN_PW, SAMPLE_PDF_URL
 */

const BASE = process.env.API_BASE ?? 'http://137.184.177.195:8080/api/v1';
const LOGIN_ID = process.env.LOGIN_ID ?? 'priya@email.com';
const LOGIN_PW = process.env.LOGIN_PW ?? 'Password@123';
// A PDF reachable from the server — used only for the self-render demonstration.
// (A real test uses a File+ upload on an actual report; this is just a smoke test.)
const SAMPLE_PDF_URL =
  process.env.SAMPLE_PDF_URL ??
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const NAME = 'SAMPLE ✦ File Attachment (inline + appended)';
const TYPE = 'lab_report';

const CSS = `
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#1f2937;margin:0}
h2{margin:0 0 4px;font-size:15pt}h4{margin:14px 0 4px}
.muted{color:#6b7280;font-size:9pt}
table{width:100%;border-collapse:collapse;font-size:9pt;margin:6px 0}
th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#f1f5f9}
.tag{background:#eff6ff;border:1px solid #60a5fa;border-radius:6px;padding:6px 10px;margin:4px 0;font-size:9pt}
.tag b{color:#1d4ed8}
.sign{display:inline-block;margin-right:28px;text-align:center}
`.trim();

const BODY = `<h2>{branch_name} &mdash; Laboratory Report</h2>
<div class="muted">Order {order_code} &middot; {order_date_time} &middot; Status {report_status}</div>
<div>Patient: <b>{patient_name}</b> ({patient_gender}) &middot; UHID {patient_um_id}</div>
<div>Test: <b>{test_name}</b> &middot; Sample {sample_type} ({sample_source_label})</div>
<table><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Method</th><th>Reference</th></tr></thead>
<tbody>{{#each results}}<tr><td>{parameter_name}</td><td>{observed1}</td><td>{unit}</td><td>{methodology}</td><td>{reference_display}</td></tr>{{/each}}</tbody></table>
<div class="muted">Interpretation: {interpretation}</div>

<h4>A) Inline attachment &mdash; drawn in place</h4>
<div class="tag"><b>&#123;test_file_attachment&#125;</b> &mdash; renders the File+ upload(s) here on this page (a PDF as pages, an image as a picture), inside the report's header/footer.</div>
{test_file_attachment}

<h4>B) Appended attachment &mdash; added as extra pages at the end</h4>
<div class="tag"><b>&#123;test_file_attachment_without_header&#125;</b> &mdash; appends the SAME File+ upload(s) as their own pages at the very END of this PDF (no report header/footer). A 5-page report + a 3-page PDF &rarr; 8 pages.</div>
{test_file_attachment_without_header}`;

const FOOTER = `<signing_authority_tag><div class="sign"><img src="{signatureImage}" style="max-height:44px"/><div><b>{name}</b></div><div class="muted">{designation}</div><div class="muted">{report_approved_by_certifications}</div></div></signing_authority_tag>`;

const META = {
  default_font: 'helvetica',
  default_font_size: '10',
  custom_css: CSS,
  header_html: '',
  body_html: BODY,
  footer_html: FOOTER,
};

// Sample render context: points BOTH tags at a real PDF so the self-test PDF
// demonstrates inline embedding AND appended pages end-to-end.
const RENDER = {
  variables: {
    branch_name: 'Demo Lab',
    order_code: 'ORD-DEMO-1',
    order_date_time: '14/10/2026 02:24 PM',
    report_status: 'PUBLISHED',
    patient_name: 'Priya Sharma',
    patient_gender: 'FEMALE',
    patient_um_id: 'UM-DEMO-1',
    test_name: 'Complete Blood Count',
    sample_type: 'EDTA Whole Blood',
    sample_source_label: 'In-House',
    interpretation: 'Within normal limits.',
    // Inline tag value: a PDF <embed> (PdfService draws its real pages in place).
    test_file_attachment: `<div class="test-file-attachment"><embed src="${SAMPLE_PDF_URL}" type="application/pdf" title="report.pdf" style="display:block;width:100%;height:120mm;border:0;" /></div>`,
    // Append tag value: the hidden marker PdfService turns into appended pages.
    test_file_attachment_without_header: `<div class="pdf-append-attachment" data-pdf-append-src="${SAMPLE_PDF_URL}" data-pdf-append-name="report.pdf" style="display:none"></div>`,
  },
  sections: {
    results: [
      {
        parameter_name: 'Haemoglobin',
        observed1: '13.5',
        unit: 'g/dL',
        methodology: 'Photometry',
        reference_display: '13-17',
      },
    ],
  },
  signatories: [
    { name: 'Dr. A. Rao', designation: 'MD Pathology', certifications: 'NABL Authorized' },
  ],
};

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
  const r = await api('/auth/login', {
    method: 'POST',
    body: { identifier: LOGIN_ID, password: LOGIN_PW },
  });
  if (!r.ok) throw new Error(`Login failed (${r.status}): ${JSON.stringify(r.json)}`);
  return r.json.data.accessToken;
}

async function findByExactName(token, type, name) {
  const r = await api(`/pdf-report-templates?type=${encodeURIComponent(type)}&limit=100`, {
    token,
  });
  const list = r.json?.data ?? [];
  return list.find((t) => t.name === name) ?? null;
}

async function main() {
  console.log(`API:   ${BASE}`);
  const token = await login();
  console.log(`Login: ${LOGIN_ID} ✓\n`);

  const existing = await findByExactName(token, TYPE, NAME);
  let id, action;
  if (existing) {
    const r = await api(`/pdf-report-templates/${existing.id}`, {
      method: 'PATCH',
      token,
      body: { name: NAME, isActive: true, meta: META },
    });
    if (!r.ok) throw new Error(`Update failed (${r.status}): ${JSON.stringify(r.json?.error ?? r.json)}`);
    id = existing.id;
    action = 'updated';
  } else {
    const r = await api('/pdf-report-templates', {
      method: 'POST',
      token,
      body: { type: TYPE, name: NAME, isActive: true, meta: META },
    });
    if (!r.ok) throw new Error(`Create failed (${r.status}): ${JSON.stringify(r.json?.error ?? r.json)}`);
    id = r.json.data.id;
    action = 'created';
  }

  const rr = await api(`/pdf-report-templates/${id}/generate`, {
    method: 'POST',
    token,
    body: RENDER,
  });
  const render = rr.ok && rr.pdfBytes
    ? `OK (${rr.pdfBytes} bytes)`
    : `FAILED ${rr.status}: ${JSON.stringify(rr.json?.error ?? rr.json)}`;

  console.log('=== Sample attachment template ===');
  console.log(`  name:   ${NAME}`);
  console.log(`  type:   ${TYPE}`);
  console.log(`  id:     ${id}  (${action})`);
  console.log(`  tags:   {test_file_attachment} + {test_file_attachment_without_header}`);
  console.log(`  render: ${render}`);
  console.log(`\nSelect "${NAME}" in the Lab Report print picker. For a real test, attach a`);
  console.log(`File+ PDF/image to a report (kind:"file") and print with this template.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
