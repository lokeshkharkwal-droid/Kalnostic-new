import { Injectable } from '@nestjs/common';
import { PdfTemplateMeta } from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto, SigningAuthorityDto } from '../dto/generate-pdf.dto';
import {
  PreparedPdfHtml,
  buildPdfDocuments,
  escapeHtml,
  escapeHtmlKeepLines,
  escapeAttr,
  imageSizeStyleAttr,
  resolveBareImageTags,
} from './pdf-document.util';

// Re-exported so existing importers (`pdf-report-template.service.ts`) that pull
// `PreparedPdfHtml` from this module keep working after the assembly logic moved
// to `pdf-document.util.ts` (now shared with the Latte all-reports renderer).
export type { PreparedPdfHtml } from './pdf-document.util';

/**
 * Matches an `{{image:<id>}}` token; ids may include a file extension (dots).
 * An optional `|w=…,h=…` sizing suffix is captured in group 2 (see
 * {@link imageSizeStyleAttr}); group 1 is always the id, so token-id collection
 * ignores the suffix.
 */
/** One `{{#each key}}...{{/each}}` block (not nested). Shared, so the blocks are found the same way everywhere. */
const EACH_BLOCK =
  /\{\{#each\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;

const IMAGE_TOKEN_RE = /\{\{image:([a-zA-Z0-9_.-]+)(?:\|([^}]*))?\}\}/g;

/**
 * Keys whose value is rich-text HTML the technician authored in a
 * `NotesRichTextEditor` (e.g. `<p><strong>…</strong></p>`), not plain text —
 * `LabReportService.buildPrintContext` is the single source of these values.
 * Escaping them (the default for every other token, to avoid layout/injection
 * issues from plain-text values) would print the literal tags instead of the
 * formatted content, so they're inserted as-is here instead. Every other key
 * (patient name, order code, `result_note`, …) is genuinely plain text and
 * must stay escaped.
 *
 * `test_file_attachment` is not technician-authored: it is `<embed>` markup the
 * server builds from the report's File+ uploads (URLs and names already
 * attribute-escaped in `buildTestFileAttachmentHtml`), so it is inserted as-is
 * for the same reason. `test_file_attachment_without_header` is likewise
 * server-built markup — hidden `display:none` markers (escaped URLs/names) the
 * PDF pipeline turns into appended pages — so it too is inserted as-is.
 *
 * `observed1` / `observed2` are plain-text readings, but `buildPrintContext`
 * escapes them itself AND may wrap an out-of-range quantitative value in the
 * configured abnormal-flag styling (`<span style="…">`) — so they arrive as
 * safe HTML and must not be re-escaped here, or the markup would print
 * literally.
 */
const RICH_TEXT_KEYS = new Set([
  'useful_for',
  'interpretation',
  'limitations',
  'remarks',
  'references',
  'overall_result',
  'test_file_attachment',
  'test_file_attachment_without_header',
  'observed1',
  'observed2',
]);

/**
 * Plain-text fields whose line breaks must survive printing: the value is escaped, and when it was typed over several
 * lines it keeps them (HTML would otherwise print "a\nb\nc" as "a b c"). `reference_display` is a reference range's
 * "Display of Reference Range", written one value per line in Master Data.
 */
const KEEP_LINE_BREAK_KEYS = new Set(['reference_display']);

/**
 * Whether a template value shows anything: text (HTML tags, `&nbsp;` and spaces
 * do not count, but an `<img>` does), a number, a true flag, or a non-empty list
 * or object. An empty rich-text box such as `<p>&nbsp;</p>` is therefore empty.
 */
function hasVisibleContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    if (/<img\b/i.test(value)) return true;
    const text = value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim();
    return text.length > 0;
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * `escapeHtml`, except for a known rich-text field — see {@link RICH_TEXT_KEYS} — and a plain-text field that keeps its
 * line breaks — see {@link KEEP_LINE_BREAK_KEYS}.
 */
function escapeUnlessRichText(key: string, value: string): string {
  const k = key.toLowerCase();
  if (RICH_TEXT_KEYS.has(k)) return value;
  return KEEP_LINE_BREAK_KEYS.has(k)
    ? escapeHtmlKeepLines(value)
    : escapeHtml(value);
}

/**
 * Collect the distinct `{{image:<id>}}` token ids referenced anywhere in the
 * given HTML fragments (header/body/footer). Used to resolve tokens against the
 * durable, tenant-wide image registry so an image uploaded in one template can be
 * reused (by pasting its token) in another. Pure — no DB, no side effects.
 * @param fragments HTML strings to scan (undefined/empty entries are ignored)
 * @returns the unique token ids, in first-seen order
 */
export function extractImageTokens(
  ...fragments: Array<string | undefined>
): string[] {
  const ids = new Set<string>();
  for (const html of fragments) {
    if (!html) {
      continue;
    }
    for (const match of html.matchAll(IMAGE_TOKEN_RE)) {
      const id = match[1];
      if (id) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

/**
 * Turns a stored template's `meta` (header/body/footer HTML + CSS) plus a render
 * context into a single, complete HTML document ready for `PdfService`.
 *
 * Supported placeholder syntax (dependency-free — no Handlebars):
 *  - `{placeholder}`         → single value from `context.variables` (HTML-escaped).
 *  - `{{#if key}}…{{/if}}`   → keep the inner markup only when `context.variables[key]`
 *                              has visible content, else drop the whole block
 *                              (nestable; no `{{else}}`; top-level variables only).
 *  - `{{image:ID}}`          → `<img>` from `context.images[ID]`.
 *  - `{{#each key}}…{{/each}}`→ repeat the inner block per row in
 *                              `context.sections[key]`; inside, `{col}` and
 *                              `{{this.col}}` resolve to the row's fields.
 *  - `<signing_authority_tag>` in the footer → expanded into one signatory block
 *    per `context.signatories`. If the tag wraps inner markup
 *    (`<signing_authority_tag>…</signing_authority_tag>`) that inner block is
 *    used as the per-signatory template; otherwise a default block is emitted.
 *
 * Interpolated values are HTML-escaped to avoid layout/injection issues;
 * unresolved placeholders collapse to empty strings.
 */
@Injectable()
export class TemplateRenderService {
  /**
   * Resolve a template + render context into the body document plus the header
   * and footer templates Puppeteer renders in the page margins (see
   * {@link PreparedPdfHtml}). Placeholders/images/repeating sections/signing
   * authority are all interpolated here.
   * @param meta the template's normalized meta (all keys present)
   * @param context the data to interpolate (variables, images, sections, signatories)
   */
  render(meta: PdfTemplateMeta, context: GeneratePdfDto): PreparedPdfHtml {
    const variables = context.variables ?? {};
    // The template's own uploaded-image registry resolves `{{image:<id>}}`
    // tokens the editor produced; a generate-time `context.images` map (e.g. a
    // per-order image) wins on id collisions.
    const images = { ...(meta.images ?? {}), ...(context.images ?? {}) };
    const sections = context.sections ?? {};

    const header = this.renderFragment(meta.header_html, variables, images, {});
    const body = this.renderFragment(
      meta.body_html,
      variables,
      images,
      sections,
    );
    const footerHtml = this.expandSigningAuthority(
      meta.footer_html,
      context.signatories ?? [],
    );
    const footer = this.renderFragment(footerHtml, variables, images, {});

    return buildPdfDocuments(meta, header, body, footer);
  }

  /**
   * Render ONLY the template's interpolated body fragment (no page wrapper, no
   * `<!DOCTYPE>`/`<html>`, no header/footer) — the direct equivalent of
   * ezHealthTrack's `get_body_section()` (`meta['body_html']`). Used to build
   * each test's `body_html` for a `lab_all_report`: every report is rendered
   * through its own configured single-report `lab_report` template's BODY, and
   * the resulting fragment is dropped per iteration by the outer all-reports
   * template (`{foreach $report_tests->tests as $r}{$r->body_html|noescape}`).
   *
   * The template's own `{{image:<id>}}` registry is merged with any
   * generate-time `context.images` (the latter wins on id collisions), exactly
   * as {@link render} does. When the template carries `custom_css`, it is
   * prefixed as a `<style>` block so each report's styling survives embedding
   * in the combined document (harmless if repeated across reports).
   * @param meta the single-report template's normalized meta (all keys present)
   * @param context the report's data (variables, images, sections)
   */
  renderBodyFragment(meta: PdfTemplateMeta, context: GeneratePdfDto): string {
    const variables = context.variables ?? {};
    const images = { ...(meta.images ?? {}), ...(context.images ?? {}) };
    const sections = context.sections ?? {};
    const body = this.renderFragment(
      meta.body_html,
      variables,
      images,
      sections,
    );
    const css = meta.custom_css?.trim()
      ? `<style>${meta.custom_css}</style>`
      : '';
    return `${css}${body}`;
  }

  /**
   * Interpolate one HTML fragment: repeating sections first, then image
   * placeholders (`{{image:ID}}`, plus bare image-valued tags such as
   * `{order_id_barcode}` standing in text — see `resolveBareImageTags`), then
   * flat `{placeholder}` variables.
   */
  private renderFragment(
    html: string,
    variables: Record<string, unknown>,
    images: Record<string, string>,
    sections: Record<string, Array<Record<string, unknown>>>,
  ): string {
    let out = this.interpolateConditionalsOutsideEach(html, variables);
    out = this.interpolateSections(out, sections, variables);
    out = this.interpolateImages(out, images);
    out = resolveBareImageTags(out, images);
    out = this.interpolateVariables(out, variables);
    return out;
  }

  /**
   * Expand `{{#if key}}…{{/if}}` blocks: the inner markup stays only when
   * `variables[key]` has visible content, otherwise the whole block (heading
   * included) is dropped. This is how a printed Notes section that was left out,
   * or that is simply empty, loses its heading and box. Blocks may be nested.
   * There is no `{{else}}` (the Latte engine would mistake it for its own tag);
   * a block that is never closed is left untouched so the mistake stays visible.
   * Outside an `{{#each}}` the key is looked up in the top-level variables; inside
   * one, in that row's fields first (see {@link interpolateSections}).
   */
  private interpolateConditionals(
    html: string,
    variables: Record<string, unknown>,
  ): string {
    const open = /\{\{#if\s+([a-zA-Z0-9_.]+)\s*\}\}/.exec(html);
    if (!open) {
      return html;
    }
    const start = open.index;
    const innerStart = start + open[0].length;
    const scan = /\{\{#if\s+[a-zA-Z0-9_.]+\s*\}\}|\{\{\/if\}\}/g;
    scan.lastIndex = innerStart;
    let depth = 1;
    let closeAt = -1;
    let closeLen = 0;
    for (let m = scan.exec(html); m; m = scan.exec(html)) {
      depth += m[0].startsWith('{{#if') ? 1 : -1;
      if (depth === 0) {
        closeAt = m.index;
        closeLen = m[0].length;
        break;
      }
    }
    if (closeAt === -1) {
      return html;
    }
    const key = open[1] ?? '';
    const resolved = this.resolveField(variables, key);
    const keep = resolved.found && hasVisibleContent(resolved.value);
    const inner = html.slice(innerStart, closeAt);
    const rest = html.slice(closeAt + closeLen);
    return (
      html.slice(0, start) +
      (keep ? this.interpolateConditionals(inner, variables) : '') +
      this.interpolateConditionals(rest, variables)
    );
  }

  /**
   * Run {@link interpolateConditionals} on everything OUTSIDE the `{{#each}}`
   * blocks. The blocks are set aside first: their `{{#if}}` belong to each row (see
   * {@link interpolateSections}) and must not be judged against the top-level
   * variables. A block wrapped around a whole `{{#each}}` still works.
   */
  private interpolateConditionalsOutsideEach(
    html: string,
    variables: Record<string, unknown>,
  ): string {
    const held: string[] = [];
    const masked = html.replace(EACH_BLOCK, (block) => {
      held.push(block);
      return `\uE000each${held.length - 1}\uE001`;
    });
    const done = this.interpolateConditionals(masked, variables);
    return done.replace(
      /\uE000each(\d+)\uE001/g,
      (_m, i: string) => held[Number(i)] ?? '',
    );
  }

  /**
   * Expand `{{#each key}}…{{/each}}` blocks by repeating the inner template for
   * each row in `sections[key]`, resolving `{{this.col}}` and `{col}` per row.
   * A `{{#if key}}…{{/if}}` inside the block is decided per row, against that row's
   * fields first and the top-level variables after (the same fallback a bare
   * `{col}` has); it is decided on the template text BEFORE the row's values go
   * in, so text inside a value is never read as a tag. Missing sections collapse
   * to empty.
   */
  private interpolateSections(
    html: string,
    sections: Record<string, Array<Record<string, unknown>>>,
    variables: Record<string, unknown> = {},
  ): string {
    return html.replace(EACH_BLOCK, (_match, key: string, inner: string) => {
      const rows = sections[key];
      if (!Array.isArray(rows)) {
        return '';
      }
      return rows
        .map((row) => {
          const scoped = this.interpolateConditionals(inner, {
            ...variables,
            ...row,
          });
          // Row scope: resolve both {{this.col}} and {col} against the row.
          let piece = scoped.replace(
            /\{\{this\.([a-zA-Z0-9_]+)\}\}/g,
            (_m, col: string) =>
              escapeUnlessRichText(
                col,
                this.stringify(this.resolveField(row, col).value),
              ),
          );
          piece = piece.replace(
            /\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g,
            (whole, col: string) => {
              const r = this.resolveField(row, col);
              return r.found
                ? escapeUnlessRichText(col, this.stringify(r.value))
                : whole;
            },
          );
          return piece;
        })
        .join('');
    });
  }

  /**
   * Replace `{{image:ID}}` with an `<img>` for each resolvable image src. An
   * optional `|w=…,h=…` suffix (`{{image:ID|w=120}}`) is turned into an inline
   * `style` on the emitted tag via {@link imageSizeStyleAttr}.
   */
  private interpolateImages(
    html: string,
    images: Record<string, string>,
  ): string {
    // Ids may include the file extension (e.g. `abc-uuid.png`), so allow dots.
    return html.replace(
      IMAGE_TOKEN_RE,
      (_match, id: string, size: string | undefined) => {
        const src = images[id];
        return src
          ? `<img src="${escapeAttr(src)}" alt="${id}"${imageSizeStyleAttr(size)} />`
          : '';
      },
    );
  }

  /**
   * Replace flat `{placeholder}` tokens with escaped values from `variables`.
   * Only matches `{identifier}` (word chars/dots) so CSS braces are untouched;
   * this runs on HTML fragments, never on the stylesheet. Lookup is
   * case-insensitive (so a legacy `{DISCOUNT_AMOUNT}` resolves the same
   * `discount_amount` context key). Unknown tokens are left as-is to surface
   * template mistakes.
   */
  private interpolateVariables(
    html: string,
    variables: Record<string, unknown>,
  ): string {
    return html.replace(
      /\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g,
      (whole, key: string) => {
        const r = this.resolveField(variables, key);
        return r.found
          ? escapeUnlessRichText(key, this.stringify(r.value))
          : whole;
      },
    );
  }

  /**
   * Resolve a token key against a context object, case-insensitively. Tries an
   * exact match first (the common path), then falls back to a case-insensitive
   * scan so templates authored with UPPERCASE tags (e.g. the legacy bill
   * templates' `{PAYMENT_COLLECTED_BY}`) resolve the lowercase snake_case keys
   * the context builders emit. `found` is false for a genuinely unknown key so
   * the caller leaves the token literal (surfacing real typos).
   */
  private resolveField(
    obj: Record<string, unknown>,
    key: string,
  ): { found: boolean; value: unknown } {
    if (key in obj) {
      return { found: true, value: obj[key] };
    }
    const lower = key.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower) {
        return { found: true, value: obj[k] };
      }
    }
    return { found: false, value: undefined };
  }

  /**
   * Expand `<signing_authority_tag>` blocks in the footer into one block per
   * signatory. A tag wrapping inner markup uses that inner block as the
   * per-signatory template (`{name}`, `{designation}`, `{registrationNumber}`,
   * `{signatureImage}`, plus that signatory's
   * `{report_approved_by_certifications}` / `{report_approved_by_qualification}` /
   * `{report_approved_by_registration_no}`); a bare tag uses a default block.
   */
  private expandSigningAuthority(
    footerHtml: string,
    signatories: SigningAuthorityDto[],
  ): string {
    const paired =
      /<signing_authority_tag>([\s\S]*?)<\/signing_authority_tag>/g;
    const bare = /<signing_authority_tag\s*\/?>/g;

    let out = footerHtml.replace(paired, (_match, inner: string) =>
      signatories
        .map((s) =>
          inner.trim()
            ? this.renderSignatoryTemplate(inner, s)
            : this.defaultSignatoryBlock(s),
        )
        .join(''),
    );
    out = out.replace(bare, () =>
      signatories.map((s) => this.defaultSignatoryBlock(s)).join(''),
    );
    return out;
  }

  /** Fill a signatory template's `{field}` tokens from a signatory. */
  private renderSignatoryTemplate(
    template: string,
    s: SigningAuthorityDto,
  ): string {
    const fields: Record<string, unknown> = {
      name: s.name,
      designation: s.designation ?? '',
      registrationNumber: s.registrationNumber ?? '',
      signatureImage: s.signatureImage ?? '',
      report_approved_by_certifications: s.certifications ?? '',
      report_approved_by_qualification: s.qualification ?? '',
      report_approved_by_registration_no: s.registrationNumber ?? '',
    };
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) =>
      key in fields ? escapeHtml(this.stringify(fields[key])) : whole,
    );
  }

  /** Default markup for one signatory when the tag carries no inner template. */
  private defaultSignatoryBlock(s: SigningAuthorityDto): string {
    const img = s.signatureImage
      ? `<img class="sa-signature" src="${escapeAttr(s.signatureImage)}" alt="signature" />`
      : '';
    const designation = s.designation
      ? `<div class="sa-designation">${escapeHtml(s.designation)}</div>`
      : '';
    const reg = s.registrationNumber
      ? `<div class="sa-reg">${escapeHtml(s.registrationNumber)}</div>`
      : '';
    const certifications = s.certifications
      ? `<div class="sa-certifications">${escapeHtml(s.certifications)}</div>`
      : '';
    return `<div class="signing-authority">${img}<div class="sa-name">${escapeHtml(
      s.name,
    )}</div>${designation}${reg}${certifications}</div>`;
  }

  /** Coerce any value to a display string (null/undefined → ''). */
  private stringify(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }
}
