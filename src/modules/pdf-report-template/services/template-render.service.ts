import { Injectable } from '@nestjs/common';
import { PdfTemplateMeta } from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto, SigningAuthorityDto } from '../dto/generate-pdf.dto';

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
   * Assemble the full HTML document for a template + render context.
   * @param meta the template's normalized meta (all keys present)
   * @param context the data to interpolate (variables, images, sections, signatories)
   * @returns a complete `<!DOCTYPE html>` document string
   */
  render(meta: PdfTemplateMeta, context: GeneratePdfDto): string {
    const variables = context.variables ?? {};
    const images = context.images ?? {};
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

    return this.buildDocument(meta, header, body, footer);
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
            (_m, col: string) => this.escape(this.stringify(row[col])),
          );
          piece = piece.replace(
            /\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g,
            (whole, col: string) =>
              col in row ? this.escape(this.stringify(row[col])) : whole,
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
    return html.replace(
      /\{\{image:([a-zA-Z0-9_-]+)\}\}/g,
      (_match, id: string) => {
        const src = images[id];
        return src ? `<img src="${this.escapeAttr(src)}" alt="${id}" />` : '';
      },
    );
  }

  /**
   * Replace flat `{placeholder}` tokens with escaped values from `variables`.
   * Only matches `{identifier}` (word chars/dots) so CSS braces are untouched;
   * this runs on HTML fragments, never on the stylesheet. Unknown tokens are
   * left as-is to surface template mistakes.
   */
  private interpolateVariables(
    html: string,
    variables: Record<string, unknown>,
  ): string {
    return html.replace(
      /\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g,
      (whole, key: string) =>
        key in variables ? this.escape(this.stringify(variables[key])) : whole,
    );
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
    };
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) =>
      key in fields ? this.escape(this.stringify(fields[key])) : whole,
    );
  }

  /** Default markup for one signatory when the tag carries no inner template. */
  private defaultSignatoryBlock(s: SigningAuthorityDto): string {
    const img = s.signatureImage
      ? `<img class="sa-signature" src="${this.escapeAttr(s.signatureImage)}" alt="signature" />`
      : '';
    const designation = s.designation
      ? `<div class="sa-designation">${this.escape(s.designation)}</div>`
      : '';
    const reg = s.registrationNumber
      ? `<div class="sa-reg">${this.escape(s.registrationNumber)}</div>`
      : '';
    return `<div class="signing-authority">${img}<div class="sa-name">${this.escape(
      s.name,
    )}</div>${designation}${reg}</div>`;
  }

  /** Wrap the fragments in a complete HTML document with base + custom CSS. */
  private buildDocument(
    meta: PdfTemplateMeta,
    header: string,
    body: string,
    footer: string,
  ): string {
    const fontFamily = meta.default_font ? `${meta.default_font}, ` : '';
    const fontSize = meta.default_font_size || '10';
    const watermark = meta.watermark_text
      ? `<div class="pdf-watermark">${this.escape(meta.watermark_text)}</div>`
      : '';

    const baseCss = `
      * { box-sizing: border-box; }
      body { font-family: ${fontFamily}sans-serif; font-size: ${this.escape(
        fontSize,
      )}pt; color: #1a1a1a; margin: 0; padding: 0; }
      .pdf-watermark { position: fixed; top: 45%; left: 0; right: 0; text-align: center;
        font-size: 72pt; color: rgba(0,0,0,0.08); transform: rotate(-30deg);
        z-index: 0; pointer-events: none; }
      .pdf-header, .pdf-body, .pdf-footer { position: relative; z-index: 1; }
      .signing-authority { display: inline-block; text-align: center; margin: 0 16px; vertical-align: bottom; }
      .signing-authority .sa-signature { max-height: 48px; display: block; margin: 0 auto 4px; }
      .signing-authority .sa-name { font-weight: bold; }
    `;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
${baseCss}
${meta.custom_css || ''}
</style>
</head>
<body>
${watermark}
<div class="pdf-header">${header}</div>
<div class="pdf-body">${body}</div>
<div class="pdf-footer">${footer}</div>
</body>
</html>`;
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

  /** Escape HTML text content. */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Escape a value for use inside a double-quoted HTML attribute. */
  private escapeAttr(value: string): string {
    return this.escape(value).replace(/"/g, '&quot;');
  }
}
