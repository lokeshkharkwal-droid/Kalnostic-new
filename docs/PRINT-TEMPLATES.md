# Print & PDF Templates — Developer Reference

> **Single source of truth for template tags.** This document is generated from
> the actual backend context-builder code (`order.service.ts`,
> `lab-report.service.ts`, `accession-sample.service.ts`) and the rendering
> engine (`pdf-report-template` module). Where it disagrees with
> `prisma/seed-print-templates.ts`, **this document wins** — the seed file is an
> illustrative fixture and some of its tags (`{tests}`, `{sample_group_label}`,
> the `lab_all_report` shape) are stale. Do not copy tags from the seed.
>
> If you add or change a print context builder, update the matching section here.

---

## Table of contents

1. [How rendering works (read this first)](#1-how-rendering-works-read-this-first)
2. [Tag syntax — the four forms](#2-tag-syntax--the-four-forms)
3. [The `meta` blob — page setup, fonts, margins](#3-the-meta-blob--page-setup-fonts-margins)
4. [Hard rules & limitations](#4-hard-rules--limitations)
5. [Template types by module](#5-template-types-by-module)
   - [Order documents](#51-order-documents) — `order_print`, `bill_print`, `accounts_biling`, `trf_print`, `lab_quotation_print`, `order_barcode_print`
   - [Lab reports](#52-lab-reports) — `lab_report`, `lab_panel`, `lab_all_report`
   - [Accession barcode labels](#53-accession-barcode-labels) — `order_label_print`, `multiple_order_label_print`
6. [Full supported type list](#6-full-supported-type-list)

---

## 1. How rendering works (read this first)

A **classic template** is three HTML fragments — `header_html`, `body_html`,
`footer_html` — stored inside a template's `meta` JSON blob, plus `custom_css`
and page settings. At print time the backend:

1. Loads the tenant's **ACTIVE** template for the requested `type` (or the
   `templateId` you pass explicitly).
2. Builds a **context** from the record's real data — a `variables` object
   (flat key→value), optional `sections` (arrays for repeating rows), optional
   `images`, and optional `signatories`.
3. Renders the HTML by substituting tags (see §2), then hands the HTML to
   Puppeteer/Chromium, which produces the PDF.

There are **three rendering engines**. You almost always want the first:

| Engine | Used by | Tag syntax |
| --- | --- | --- |
| **Classic (flat)** | Everything except `lab_all_report` and block templates | `{var}`, `{{#each}}`, `{{image:id}}`, `<signing_authority_tag>` |
| **Latte-subset** | `lab_all_report`, `lab_all_report_with_letterhead` | nested iteration over pre-rendered `body_html` — see [§5.2](#lab_all_report) |
| **Advance / block** | Any template whose `doc` column is non-null | structured JSON, not HTML — **out of scope for this doc** |

> The frontend Print buttons only ever list **classic** templates
> (`doc == null`) — see `kaltros-fe/src/lib/print-templates/print-template.api.ts`.
> Block/advance templates cannot be used for record-bound printing.

---

## 2. Tag syntax — the four forms

There are exactly four tag forms. Getting the brace count right is the single
most common source of "my tag didn't work".

### 2.1 Flat variable — `{key}` (single brace)

```html
<div>Order: {order_code} — {patient_name}</div>
```

- **Single** curly braces. Looks the key up in `context.variables`.
- Allowed characters: letters, digits, `_`, `.` → regex
  `/\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g`.
- **Case-insensitive fallback:** an exact match is tried first, then a
  case-insensitive scan. So `{PATIENT_NAME}` resolves to `patient_name`. (Legacy
  UPPERCASE tags keep working — but prefer the exact lower-case key.)
- **Values are HTML-escaped automatically.** Don't try to inject markup through a
  variable; it will be escaped.
- **Unknown key → left literal.** `{nope}` stays as the text `{nope}` in the
  output. This is deliberate so typos are visible in the PDF. If a tag prints as
  literal text, you spelled it wrong or it isn't in that type's context.
- `null`/`undefined` → empty string; numbers/booleans stringify; objects/arrays
  → JSON.

### 2.2 Repeating section — `{{#each key}} … {{/each}}` (double brace)

```html
<table>
  <tbody>
  {{#each items}}
    <tr><td>{sr_no}</td><td>{name}</td><td>{price}</td></tr>
  {{/each}}
  </tbody>
</table>
```

- **Double** curly braces on the block markers. `key` is a section name from
  `context.sections` (e.g. `items`, `payments`, `results`, `labels`).
- **Inside the block**, reference each row's fields with the flat `{col}` form
  (single brace, case-insensitive) **or** the explicit `{{this.col}}` form.
- **ONE LEVEL ONLY.** You cannot nest `{{#each}}` inside `{{#each}}`. A nested
  block is left as literal text. (This is why multi-sample labels and
  `lab_all_report` flatten their data into a single top-level section.)
- **No `{{#if}}` / conditionals** in the classic engine.
- Missing/empty/non-array section → the whole block collapses to nothing.

### 2.3 Uploaded image — `{{image:id}}` (double brace)

```html
<img-slot>{{image:logo.png}}</img-slot>
```

- Replaced with a full `<img src="…" alt="id" />` tag.
- Resolves the URL in priority order: runtime `context.images` → this template's
  `meta.images` → the tenant-wide **`PrintTemplateImage` registry** (so an image
  uploaded to one template can be reused in another by pasting its token).
- Unknown id → collapses to empty (no `<img>` emitted).

### 2.4 Signatories — `<signing_authority_tag> … </signing_authority_tag>`

```html
<!-- footer_html only -->
<signing_authority_tag>
  <div class="sign">
    <img src="{signatureImage}" style="max-height:48px" />
    <div><b>{name}</b></div>
    <div>{designation}</div>
    <div>{report_approved_by_certifications}</div>
  </div>
</signing_authority_tag>
```

- **Use in `footer_html` only.** Repeats the inner block once per entry in
  `context.signatories` (0–3 for lab reports).
- Row keys available inside: `{name}`, `{designation}`, `{registrationNumber}`,
  `{signatureImage}` (URL), `{report_approved_by_certifications}`. Missing ones
  render empty.
- A **bare** `<signing_authority_tag/>` (no inner HTML) emits a built-in default
  block with classes `.signing-authority`, `.sa-signature`, `.sa-name`,
  `.sa-designation`, `.sa-reg`, `.sa-certifications`.
- Only `lab_report` / `lab_panel` / `lab_all_report` populate `signatories`.
  Order/label templates leave it empty (the tag renders nothing).

---

## 3. The `meta` blob — page setup, fonts, margins

Every classic template stores these alongside the HTML. Missing keys are filled
from `PDF_TEMPLATE_META_DEFAULTS`, so you only set what you want to change.

| Field | Default | Purpose |
| --- | --- | --- |
| `header_html` | `''` | Header HTML. **Repeated on every page.** |
| `body_html` | `''` | Main content (flows across pages). |
| `footer_html` | `''` | Footer HTML. **Repeated on every page.** Home of `<signing_authority_tag>`. |
| `custom_css` | `''` | CSS injected into body **and** header/footer (up to 100K chars). |
| `default_font` | `''` | `courier` \| `helvetica` \| `times` \| `dejavusans` \| `dejavuserif` \| `timesb` \| `helveticab`. Empty = sans default. |
| `default_font_size` | `'10'` | Points (string). Always set explicitly for headers/footers (Chromium zeroes it otherwise). |
| `orientation` | `'P'` | `'P'` portrait / `'L'` landscape. |
| `page_size` | `'A4'` | ISO `A0`–`A12`, `B0`–`B12`, `C0`–`C12`/`C76`, barcode `CB1` (100×25mm), `CB2` (50×25mm), or `Letter`/`Legal`. |
| `margin_left` / `margin_right` | `'15'` / `'10'` | mm (string). |
| `margin_top` / `margin_bottom` | `'10'` / `'10'` | mm. **This IS the header/footer band height** — the header is confined to `[margin_header, margin_top]`, the footer to the band above `margin_footer`, and the body flows strictly between. Size `margin_top`/`margin_bottom` to fit your header/footer; content taller than the band is scaled (images) then clipped — it can never overflow into the body. |
| `margin_header` / `margin_footer` | `'5'` / `'5'` | mm from the page edge to header/footer content (the gap inside the band). Must be `< margin_top` / `< margin_bottom`; a larger value is clamped. |
| `watermark_text` | `''` | Text watermark (72pt, −30°, ~8% opacity). |
| `watermark_image` | `''` | Image watermark URL. **Takes precedence** over `watermark_text`. |
| `images` | `{}` | `{ id: url }` registry backing `{{image:id}}`. |
| `template_version`, `header_name`, `body_name`, `footer_name`, `associate_body_image` | `''` | Labels/metadata (UI only, no render effect). |

**Header/footer gotchas**

- They render in an **isolated Chromium context** and do **not** inherit the body
  stylesheet — `custom_css` is injected into them separately, but body-only
  `<style>` blocks won't apply. Put shared styles in `custom_css`.
- **They are confined to their band.** The renderer wraps header/footer HTML in a
  fixed-height box (`= margin_top` / `margin_bottom`) with `overflow: hidden`,
  anchored to the page edge by `margin_header` / `margin_footer`. Images are
  auto-scaled (`max-width: 100%`, `max-height: band content height`,
  `object-fit: contain`) and wide tables/long words are constrained to the content
  width. So header content can never bleed into the body/footer regardless of page
  size or orientation — **but** if the band is too small the excess is clipped
  (header from the bottom, footer from the top). If your letterhead looks cut off,
  increase `margin_top` (not `margin_header`).
- Always give header/footer an explicit font size.
- If both `header_html` and `footer_html` are blank, Puppeteer's
  `displayHeaderFooter` stays off and you get a clean body-only PDF (no Chromium
  date/page chrome).
- For barcode labels, set `page_size` to `CB1`/`CB2` and zero the margins — the
  label templates ship with empty header/footer for exactly this reason.

---

## 4. Hard rules & limitations

- **Classic vs. block.** A template with a non-null `doc` column is a block/advance
  template rendered by a different engine; its `meta.*_html` is ignored, and it
  can't be used for record-bound printing. Everything in this doc is classic
  (`doc == null`).
- **ACTIVE + not soft-deleted.** Only `isActive = true`, `deletedAt = null`
  templates are listed/resolved.
- **Template resolution / ambiguity.** When you print without an explicit
  `templateId`, the backend resolves the tenant's single active template of that
  `type`. **Zero active → error** (`NoActiveLabelTemplateException` /
  no-template). **More than one active and none configured as default → ambiguity
  error** (`AmbiguousLabelTemplateException`). Set a Configuration default per
  slot, or pass `templateId`.
- **Unique name per tenant** among active templates → 409
  `PDF_REPORT_TEMPLATE_NAME_CONFLICT` on collision.
- **Tenant/branch scoped.** `branchId = null` → tenant-wide; a branch UUID → that
  branch only. Global SITE_ADMIN templates (`tenantId = null`) can be cloned into
  a tenant.
- **Currency values are in minor units.** `price: 100` means ₹1.00. Format for
  display in the template/CSS as needed; the engine does not divide by 100.
- **Dates/times are pre-formatted** to the tenant's locale + timezone by the
  builder. You get display strings, not ISO — print them as-is.
- **Type mismatch** (unknown `type`) → 400 `INVALID_PDF_REPORT_TEMPLATE_TYPE`.
- **Render failure** (bad HTML, Puppeteer error) → 500 `PDF_GENERATION_FAILED`.

---

## 5. Template types by module

Legend for every tag table below:
- **Flat** tags are used as `{tag}` anywhere in header/body/footer.
- **Section** tags are used inside `{{#each sectionName}} … {{/each}}` as `{field}`.

---

### 5.1 Order documents

All six render from one order via **`POST /orders/:id/print`** with a body of
`{ "type": "<type>", "templateId": "<id>" }`.
Context is built in `order.service.ts` (`buildOrderPrintContext` etc.,
around lines 2224–2439).

#### Shared building blocks

Most order documents include the same **patient**, **referral**, and **item**
data, so those are listed once here and referenced by each type.

**Patient flat tags** (from `patientVariables()`):

| Tag | Description |
| --- | --- |
| `{patient_name}` | Full name (first + middle + last). |
| `{patient_salutation}` | Salutation label (Mr/Ms/Dr…). |
| `{client_salutation}` | Legacy alias of `patient_salutation`. |
| `{patient_age}` | Full age: `25 Years, 4 Months, 12 Days` when the patient's date of birth is known; falls back to the single-unit snapshot (e.g. `25 Years`) when DOB is missing, or blank when age is unknown. Shared by every order-document type. |
| `{patient_gender}` | Gender label. |
| `{patient_um_id}` | UHID / UMID. |
| `{patient_mobile}` | Mobile. |
| `{patient_email}` | Email. |
| `{patient_blood_group}` | Blood group. |
| `{patient_address1}` | Address line 1. |
| `{patient_dob}` | Date of birth (locale-formatted). |

**Referral flat tags** (from `referralVariables()`):

| Tag | Description |
| --- | --- |
| `{referred_by}` | Referring doctor name, or `Self`. |
| `{referral_panel}` | Referral panel name, or `Walk-in`. |

**`items` section row** (also used as `tests` in `trf_print`):

| Field | Description |
| --- | --- |
| `{sr_no}` | 1-based row number. |
| `{name}` | Test / panel / direct item name. |
| `{code}` | Test or panel code (empty for direct items). |
| `{type}` | `Test`, `Panel`, or `Direct`. |
| `{price}` | Unit price (minor units). |
| `{discount}` | Item-level discount (minor units). |
| `{panel_tests_name}` | For a panel row, comma-joined member test names. |

---

#### `order_print` — Order slip

**Flat:** all patient + referral tags, plus:
`{order_code}`, `{bill_id}`, `{order_date}`, `{order_time}`, `{status}`,
`{branch_name}`, `{item_count}`, `{panel_tests_name}` (flat, comma-joined across
all items).
**Sections:** `items`.

```html
<!-- header_html -->
<h2>{branch_name}</h2><div>Order Slip</div>

<!-- body_html -->
<div>Order: <b>{order_code}</b> · Bill: {bill_id} · Date: {order_date} {order_time} · Status: {status}</div>
<div class="muted">{patient_name} · {patient_age} · {patient_gender} · UHID: {patient_um_id}</div>
<div class="muted">Referred By: {referred_by} · Panel: {referral_panel} · Items: {item_count}</div>
<table>
  <thead><tr><th>#</th><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Disc</th></tr></thead>
  <tbody>
  {{#each items}}
    <tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{type}</td><td>{price}</td><td>{discount}</td></tr>
  {{/each}}
  </tbody>
</table>

<!-- footer_html -->
<div class="muted">Order {order_code}</div>
```

---

#### `bill_print` — Patient bill

**Flat:** all patient + referral tags, plus:
`{bill_id}` (falls back to order code), `{order_code}`, `{order_date}`,
`{order_date_time}` (order date + order time, e.g. `21/09/2026 01:30 PM` —
distinct from `{bill_date_time}`, which is when the bill was generated),
`{bill_date_time}`, `{payment_collected_by}`, `{status}`, `{payment_status}`,
`{bill_status}` (alias of `payment_status`), `{branch_name}`,
`{gross_amount}`, `{discount_amount}`, `{discount_percentage}`, `{net_amount}`,
`{total_amount_in_words}`, `{paid_amount}`, `{balance_amount}`,
`{panel_tests_name}`.
**Sections:** `items`, `payments`.

**`payments` section row:** `{date}`, `{mode}`, `{reference}`, `{amount}`.

```html
<!-- body_html -->
<div>Bill: <b>{bill_id}</b> · Order: {order_code} · {bill_date_time} · {status} ({payment_status})</div>
<div class="muted">{patient_name} · {patient_age}/{patient_gender} · UHID: {patient_um_id}</div>
<table>
  <thead><tr><th>#</th><th>Service</th><th>Code</th><th>Price</th><th>Disc</th></tr></thead>
  <tbody>
  {{#each items}}
    <tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{price}</td><td>{discount}</td></tr>
  {{/each}}
  </tbody>
</table>
<div>Gross: {gross_amount} · Discount: {discount_amount} ({discount_percentage}%) · Net: <b>{net_amount}</b></div>
<div>Paid: {paid_amount} · Balance: {balance_amount}</div>
<div class="muted">In words: {total_amount_in_words}</div>
<h4>Payments</h4>
<table>
  <thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th>Amount</th></tr></thead>
  <tbody>
  {{#each payments}}
    <tr><td>{date}</td><td>{mode}</td><td>{reference}</td><td>{amount}</td></tr>
  {{/each}}
  </tbody>
</table>
```

---

#### `accounts_biling` — Accounts / B2B billing

Everything in `bill_print` (same flat tags + `items` + `payments` sections),
**plus** the referral-panel accounts block:

| Tag | Description |
| --- | --- |
| `{panel_name}` | Referral panel name. |
| `{panel_code}` | Referral panel code. |
| `{panel_accounts_person}` | Accounts contact person. |
| `{panel_accounts_email}` | Accounts contact email. |
| `{panel_accounts_mobile}` | Accounts contact mobile. |

> Note the type string is spelled `accounts_biling` (single "l") in code — match
> it exactly.

---

#### `trf_print` — Test requisition form

**Flat:** all patient + referral tags, plus:
`{trf_ref}` (bill id or order code), `{order_code}`, `{order_date}`,
`{order_date_time}` (order date + order time, e.g. `21/09/2026 01:30 PM`),
`{clinical_notes}`, `{branch_name}`, `{panel_tests_name}`.
**Sections:** `tests` (same row shape as `items`, **plus** `{status}` which is
hard-coded to `REQUESTED`).

```html
<!-- body_html -->
<div>TRF Ref: <b>{trf_ref}</b> · Order: {order_code} · {order_date}</div>
<div class="muted">{patient_name} · {patient_age}/{patient_gender} · UHID: {patient_um_id}</div>
<div class="muted">Referred By: {referred_by} · Panel: {referral_panel}</div>
<table>
  <thead><tr><th>#</th><th>Test / Service</th><th>Code</th><th>Status</th></tr></thead>
  <tbody>
  {{#each tests}}
    <tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{status}</td></tr>
  {{/each}}
  </tbody>
</table>
<h4>Clinical Notes</h4><div>{clinical_notes}</div>
```

---

#### `lab_quotation_print` — Quotation

**Flat:** all patient + referral tags, plus:
`{quote_id}` (order code), `{quote_date}`, `{valid_till}`, `{status}`,
`{branch_name}`, `{gross_amount}`, `{discount_amount}`, `{net_amount}`,
`{panel_tests_name}`.
**Sections:** `items`.

```html
<!-- body_html -->
<div>Quotation: <b>{quote_id}</b> · {quote_date} · Valid till: {valid_till} · {status}</div>
<div class="muted">{patient_name} · {patient_age}/{patient_gender}</div>
<table>
  <thead><tr><th>#</th><th>Service</th><th>Code</th><th>Type</th><th>Price</th></tr></thead>
  <tbody>
  {{#each items}}
    <tr><td>{sr_no}</td><td>{name}</td><td>{code}</td><td>{type}</td><td>{price}</td></tr>
  {{/each}}
  </tbody>
</table>
<div>Gross: {gross_amount} · Discount: {discount_amount} · Net: <b>{net_amount}</b></div>
```

---

#### `order_barcode_print` — Order-level barcode label

A single label for the **whole order** (distinct from the per-sample
`order_label_print` in the Accession module).

**Flat:** `{order_code}`, `{barcode}` (= order code; wrap as `*{barcode}*` for a
Code 39 font), `{order_date}`, `{branch_name}`, `{test_names}` (comma-joined all
items), and the core patient tags (`{patient_name}`, `{patient_age}`,
`{patient_gender}`, `{patient_um_id}`, `{patient_mobile}`, …; **no** `{patient_dob}`).
**Sections:** none.

```html
<!-- body_html; set page_size CB1/CB2, empty header/footer, zero margins -->
<div class="label">
  <div class="barcode">*{barcode}*</div>
  <div><b>{patient_name}</b> ({patient_age}/{patient_gender})</div>
  <div class="muted">UHID: {patient_um_id}</div>
  <div>{order_code} · {order_date}</div>
  <div class="muted">Tests: {test_names}</div>
</div>
```

---

### 5.2 Lab reports

#### `lab_report` and `lab_panel` — single test / panel report

**Endpoint:** `POST /lab-reports/:id/print` with
`{ "type": "lab_report" | "lab_panel", "templateId": "<id>" }`.
Both types share the **exact same context** (`buildPrintContext`,
`lab-report.service.ts:2441`) — the `type` only selects which template to use, so
their tag lists are identical.

**Flat tags:**

| Tag | Description |
| --- | --- |
| `{order_code}` | Order identifier. |
| `{order_date}` | Order date (locale). |
| `{order_date_time}` | Order date + time. |
| `{order_external_id}` / `{external_order_id}` | Client's external order id (aliases). |
| `{patient_name}` | Full name. |
| `{patient_salutation}` | Salutation. |
| `{patient_age}` | Full age: `25 Years, 4 Months, 12 Days` when DOB is known; single-unit fallback (e.g. `25 Years`) otherwise, or blank when age is unknown. |
| `{patient_gender}` | Gender label. |
| `{patient_um_id}` | UHID. |
| `{patient_mobile}` | Mobile. |
| `{patient_address1}` | Address line 1. |
| `{referred_by}` | Referring doctor. |
| `{referral_panel}` | Referring panel. |
| `{test_name}` | Test/panel name being reported. |
| `{report_status}` | Report status (SAVED/APPROVED/PUBLISHED…). |
| `{useful_for}` | Clinical "useful for" (report → test-master fallback). |
| `{interpretation}` | Interpretation text. |
| `{limitations}` | Limitations text. |
| `{references}` | References text. |
| `{last_report_prepared_on}` | Latest approval time on the order. |
| `{sample_collected_date}` | Sample collection time (branch-local). |
| `{sample_received_date}` | Sample receipt time. |
| `{sample_type}` | Sample type. |
| `{sample_source_label}` | In-House / Supplied label. |
| `{sample_note}` | Most recent sample-category note. |
| `{report_approved_by_name}` | First approving doctor's name. |
| `{report_approved_by_designation}` | First approving doctor's designation. |
| `{report_approved_by_certifications}` | Comma-joined certs (NABL/CAP/ISO). |
| `{report_approved_by_signature}` | Signature image URL. |
| `{patient_image}` | Patient photo URL. |
| `{order_id_barcode}` | Order barcode **value** (text). |
| `{order_id_qr_code}` | Order barcode/QR **image URL**. |

**Image tags** (`{{image:key}}`): `report_approved_by_signature`,
`patient_image`, `order_id_qr_code`.

**`results` section row** (parameter rows, sorted by catalogue order):

| Field | Description |
| --- | --- |
| `{parameter_name}` | Analyte / parameter name. |
| `{observed1}` | Primary observed value. |
| `{observed2}` | Secondary observed value. |
| `{unit}` | Measurement unit. |
| `{methodology}` / `{method_name}` | Method (aliases). |
| `{reference_display}` | Formatted reference range. |
| `{group_name}` | Parameter group heading. |
| `{result_note}` | Per-parameter note. |

**Signatories:** up to 3 → use `<signing_authority_tag>` in the footer (keys:
`{name}`, `{designation}`, `{registrationNumber}`, `{signatureImage}`,
`{report_approved_by_certifications}`).

```html
<!-- header_html -->
<h2>{branch_name}</h2><div>Laboratory Report</div>

<!-- body_html -->
<div>Order: <b>{order_code}</b> · {order_date_time}</div>
<div class="muted">{patient_name} · {patient_age}/{patient_gender} · UHID: {patient_um_id}</div>
<div>Test: <b>{test_name}</b> · Status: {report_status}</div>
<div>Collected: {sample_collected_date} · Received: {sample_received_date} · Sample: {sample_type} ({sample_source_label})</div>
<table>
  <thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Method</th><th>Reference</th></tr></thead>
  <tbody>
  {{#each results}}
    <tr><td>{parameter_name}</td><td>{observed1}</td><td>{unit}</td><td>{methodology}</td><td>{reference_display}</td></tr>
  {{/each}}
  </tbody>
</table>
<div class="muted">Interpretation: {interpretation}</div>
<div class="muted">Useful For: {useful_for}</div>
<div class="muted">Limitations: {limitations}</div>
<div class="muted">References: {references}</div>

<!-- footer_html -->
<signing_authority_tag>
  <div style="display:inline-block;margin-right:24px">
    <img src="{signatureImage}" style="max-height:48px" /><br/>
    <b>{name}</b><div class="muted">{designation}</div>
    <div class="muted">{report_approved_by_certifications}</div>
  </div>
</signing_authority_tag>
```

<a name="lab_all_report"></a>
#### `lab_all_report` — consolidated all-tests report ⚠️ different engine

**Endpoint:** `POST /lab-reports/order/:orderId/print-all` with
`{ "templateId": "<id>", "orderItemIds?": [...] }`.
Built by `buildAllReportsContext` (`lab-report.service.ts:2762`). This type is
rendered by the **Latte-subset engine**, not the flat engine, and its context has
a **different, nested shape** — do **not** reuse the `lab_report` tags at the top
level, and do **not** trust the seed's `{{#each reports}}` example (it's stale).

The context is:

```
{
  header_fields: { … },          // shared, printed once
  report_tests: {
    groups: [],                  // reserved, currently empty
    tests: [ { body_html, … } ]  // one entry per test; body_html is PRE-RENDERED
  }
}
```

**`header_fields` (printed once):**

| Key | Description |
| --- | --- |
| `header_image` | Letterhead image (currently empty). |
| `patient.salutation` | Salutation. |
| `patient.full_name` | Full name. |
| `client_age` | Full age: `25 Years, 4 Months, 12 Days` when DOB is known; single-unit fallback otherwise. |
| `client_gender` | Single-char gender. |
| `client_phone` | Mobile. |
| `client_uhid` | UHID. |
| `external_order_id` | External order id. |
| `sample_source_label` | In-House / Supplied. |
| `refer_by_name` | Referring doctor (or ` -- `). |
| `referring_panel_name` | Referring panel (or ` -- `). |
| `order_date_time` | Order date/time. |
| `order_id_barcode` | Order QR/barcode image URL. |

**`report_tests.tests[]` (one per test):**

| Key | Description |
| --- | --- |
| `body_html` | **Pre-rendered** result table + interpretation/useful-for/limitations/references/note sections for that test. Emit it as raw HTML — you do not build the results table yourself. |
| `sample_collected_date` | Collection time. |
| `sample_received_date` | Receipt time. |
| `report_prepared_on` | Approval/publish time. |
| `lab_test_id` | Tenant-master test id. |
| `tests` | `[{ display_test_sample: '1' }]` visibility gate (mostly unused). |

Because `body_html` is already built by the backend, a `lab_all_report` template
is mostly a wrapper: print the header once, then iterate the tests and drop each
`body_html` in. The per-test result formatting is **not** controlled here — it is
built server-side (`buildTestBodyHtml`, `lab-report.service.ts:2881`).

> Because this engine and shape differ from the flat classic engine, if you need
> to edit a `lab_all_report` layout, start from the tenant's existing active
> `lab_all_report` template rather than authoring one from scratch, and verify by
> rendering a real multi-test order.

---

### 5.3 Accession barcode labels

Rendered from accession **order-samples**, built by `buildLabelVariables`
(`accession-sample.service.ts:1311`). This is the template behind **Print Barcode**
on `/accession/inhouse-orders`.

Both types share the same per-sample fields:

| Tag | Description |
| --- | --- |
| `{accession_no}` | Sample accession number. |
| `{barcode}` | Barcode **value** (text). Wrap as `*{barcode}*` for a Code 39 font. |
| `{orderIdBarcode}` | **S3 URL of the scannable barcode image** — use `<img src="{orderIdBarcode}">`. |
| `{patient_name}` | Full name (first + middle + last). |
| `{patient_age}` | Full age: `25 Years, 4 Months, 12 Days` when the patient's date of birth is known; falls back to the single-unit snapshot (e.g. `25 Years`) when DOB is missing, or blank when age is unknown. |
| `{patient_gender}` | Gender. |
| `{patient_um_id}` | UHID / UMID. |
| `{department_name}` | Department name(s) of the sample's tests. A sample can span multiple departments → distinct names, comma-joined (e.g. `Biochemistry, Hematology`). Blank when no department is assigned. |
| `{order_code}` | Order code. |
| `{test_names}` | Comma-joined test names. |
| `{sample_type}` | Sample type. |
| `{container_type}` | Container / tube type. |
| `{priority}` | Priority. |
| `{collected_at}` | Collection date **and** time, e.g. `21/09/2026 01:30 PM` (date + space + tenant 12h/24h time). Blank when the sample has no collection time. |

> ⚠️ The seed file's label uses `{tests}` and `{sample_group_label}` — **those do
> not exist.** Use `{test_names}`; there is no sample-group-label tag. For a real
> scannable image prefer `{orderIdBarcode}` over the font-rendered `*{barcode}*`.

#### `order_label_print` — one sample per print

**Endpoint:** `POST /accession/order-samples/print-label` with
`{ "sampleId": "<id>", "templateId": "<id>" }`.
Flat tags only (no sections).

```html
<!-- body_html; page_size CB1/CB2, empty header/footer, zero margins -->
<div class="label">
  <div class="barcode-img"><img src="{orderIdBarcode}" alt="{barcode}" /></div>
  <div class="barcode-text">*{barcode}*</div>
  <div><b>{patient_name}</b> ({patient_age}/{patient_gender})</div>
  <div class="muted">UHID: {patient_um_id}</div>
  <div>{order_code} / {accession_no}</div>
  <div class="muted">Dept: {department_name}</div>
  <div class="muted">{sample_type} · {container_type} · {priority}</div>
  <div class="muted">Tests: {test_names}</div>
  <div class="muted">Collected: {collected_at}</div>
</div>
```

Suggested CSS:

```css
.label{display:inline-block;border:1px dashed #333;padding:6px;margin:4px;width:220px;font-size:9pt}
.barcode-img img{width:100%;height:44px;object-fit:contain}
.barcode-text{font-family:monospace;font-size:14pt;letter-spacing:2px;text-align:center}
.muted{color:#555;font-size:8pt}
```

#### `multiple_order_label_print` — many samples, one PDF

**Endpoint:** `POST /accession/order-samples/print-labels` with
`{ "ids": ["<id>", …], "templateId": "<id>" }`.
Every sample is folded into a single top-level **`labels`** section (one level of
`{{#each}}` — remember, no nesting). Inside the block, use the same per-sample
tags.

```html
<!-- body_html -->
{{#each labels}}
<div class="label">
  <div class="barcode-img"><img src="{orderIdBarcode}" alt="{barcode}" /></div>
  <div class="barcode-text">*{barcode}*</div>
  <div><b>{patient_name}</b> ({patient_age}/{patient_gender})</div>
  <div class="muted">UHID: {patient_um_id}</div>
  <div>{order_code} / {accession_no}</div>
  <div class="muted">Dept: {department_name}</div>
  <div class="muted">{sample_type} · Tests: {test_names}</div>
  <div class="muted">Collected: {collected_at}</div>
</div>
{{/each}}
```

---

## 6. Full supported type list

The `type` string must be one of `PDF_REPORT_TEMPLATE_TYPES`
(`pdf-report-template/constants/pdf-report-template-types.constant.ts`). The
record-bound Print buttons currently use only the subset documented above:
`order_print`, `bill_print`, `accounts_biling`, `trf_print`,
`lab_quotation_print`, `order_barcode_print`, `lab_report`, `lab_panel`,
`lab_all_report`, `order_label_print`, `multiple_order_label_print`.

Many other types exist in the catalogue (patient cards, consent forms, OPD
visit-note prints, radiology reports, blood-bank labels, pharmacy invoices, etc.)
but their context builders are not yet wired to a print endpoint. When one is
added, document its tags here in the same format: **endpoint → working example →
flat tags → section tags → rules**.

---

### Where the tags come from (for maintainers)

| Types | Context builder |
| --- | --- |
| `order_*`, `bill_print`, `accounts_biling`, `trf_print`, `lab_quotation_print` | `src/modules/order/order.service.ts` (`buildOrderPrintContext` … `buildOrderBarcodeContext`, ~L2224–2439) |
| `lab_report`, `lab_panel` | `src/modules/lab-report/lab-report.service.ts` `buildPrintContext` (L2441) |
| `lab_all_report` | `src/modules/lab-report/lab-report.service.ts` `buildAllReportsContext` (L2762) |
| `order_label_print`, `multiple_order_label_print` | `src/modules/accession/accession-sample.service.ts` `buildLabelVariables` (L1311) |
| Rendering engine & `meta` | `src/modules/pdf-report-template/` (`template-render.service.ts`, `pdf-document.util.ts`, `constants/pdf-template-meta.constant.ts`) |
