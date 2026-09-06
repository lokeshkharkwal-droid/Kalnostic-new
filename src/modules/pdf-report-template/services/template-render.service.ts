import { Injectable } from '@nestjs/common';
import { PdfTemplateMeta } from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto, SigningAuthorityDto } from '../dto/generate-pdf.dto';
import {
  PreparedPdfHtml,
  buildPdfDocuments,
  escapeHtml,
  escapeAttr,
} from './pdf-document.util';

// Re-exported so existing importers (`pdf-report-template.service.ts`) that pull
// `PreparedPdfHtml` from this module keep working after the assembly logic moved
// to `pdf-document.util.ts` (now shared with the Latte all-reports renderer).
export type { PreparedPdfHtml } from './pdf-document.util';

/** Matches an `{{image:<id>}}` token; ids may include a file extension (dots). */
const IMAGE_TOKEN_RE = /\{\{image:([a-zA-Z0-9_.-]+)\}\}/g;

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
   * Interpolate one HTML fragment: repeating sections first, then image
   * placeholders, then flat `{placeholder}` variables.
   */
  private renderFragment(
    html: string,
    variables: Record<string, unknown>,
    images: Record<string, string>,
    sections: Record<string, Array<Record<string, unknown>>>,
  ): string {
    let out = this.interpolateSections(html, sections);
    out = this.interpolateImages(out, images);
    out = this.interpolateVariables(out, variables);
    return out;
  }

  /**
   * Expand `{{#each key}}…{{/each}}` blocks by repeating the inner template for
   * each row in `sections[key]`, resolving `{{this.col}}` and `{col}` per row.
   * Missing sections collapse to empty.
   */
  private interpolateSections(
    html: string,
    sections: Record<string, Array<Record<string, unknown>>>,
  ): string {
    const eachBlock =
      /\{\{#each\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
    return html.replace(eachBlock, (_match, key: string, inner: string) => {
      const rows = sections[key];
      if (!Array.isArray(rows)) {
        return '';
      }
      return rows
        .map((row) => {
          // Row scope: resolve both {{this.col}} and {col} against the row.
          let piece = inner.replace(
            /\{\{this\.([a-zA-Z0-9_]+)\}\}/g,
            (_m, col: string) =>
              escapeHtml(this.stringify(this.resolveField(row, col).value)),
          );
          piece = piece.replace(
            /\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g,
            (whole, col: string) => {
              const r = this.resolveField(row, col);
              return r.found ? escapeHtml(this.stringify(r.value)) : whole;
            },
          );
          return piece;
        })
        .join('');
    });
  }

  /** Replace `{{image:ID}}` with an `<img>` for each resolvable image src. */
  private interpolateImages(
    html: string,
    images: Record<string, string>,
  ): string {
    // Ids may include the file extension (e.g. `abc-uuid.png`), so allow dots.
    return html.replace(
      /\{\{image:([a-zA-Z0-9_.-]+)\}\}/g,
      (_match, id: string) => {
        const src = images[id];
        return src ? `<img src="${escapeAttr(src)}" alt="${id}" />` : '';
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
        return r.found ? escapeHtml(this.stringify(r.value)) : whole;
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
   * `{signatureImage}`); a bare tag uses a default block.
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
