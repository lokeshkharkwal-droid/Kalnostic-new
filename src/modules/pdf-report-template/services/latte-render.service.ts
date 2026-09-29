import { Injectable } from '@nestjs/common';
import { PdfTemplateMeta } from '../constants/pdf-template-meta.constant';
import {
  PreparedPdfHtml,
  buildPdfDocuments,
  resolveImageTokens,
} from './pdf-document.util';
import { renderLatte } from './latte-renderer.util';

/**
 * Renders a `lab_all_report`-type template with the Latte engine — the report
 * templates ported from the legacy app iterate every test on an order
 * (`{foreach $report_tests->groups…}`), drop each test's pre-rendered
 * `body_html`, and manage their own per-test page headers/breaks. That is a
 * fundamentally different shape from the flat `{tag}`/`{{#each}}` engine in
 * {@link TemplateRenderService}, so `lab_all_report` routes here instead.
 *
 * The context is the order-scoped `report_tests` / `header_fields` object built
 * by `LabReportService.buildAllReportsContext`. After Latte interpolation the
 * mPDF running-header tags (`<htmlpageheader>` / `<sethtmlpageheader>`) are
 * translated to inline per-test header blocks (Puppeteer has no per-page-range
 * HTML header mechanism); `page-break-after` divs — which Chromium honours —
 * paginate between tests. The assembled document reuses the exact same page
 * frame / base CSS / margins as the flat path via {@link buildPdfDocuments}.
 */
@Injectable()
export class LatteReportRenderService {
  /**
   * Resolve `meta.header_html`/`body_html`/`footer_html` against the Latte
   * context into the Puppeteer body + header/footer templates.
   *
   * Uploaded/registry `{{image:ID}}` tokens are resolved to their real `<img>`
   * BEFORE Latte parsing (see {@link resolveImageTokens}) so a header logo /
   * letterhead pasted into a Latte-bodied template renders — the Latte engine
   * would otherwise rewrite `{{image:ID}}` to a `{$ID}` variable the context
   * never supplies (and an uploaded id like `logo-x.png` isn't even a valid
   * Latte variable), silently dropping the image. Tokens NOT in `images` are
   * left for that `{$ID}` fallback (context-provided URLs, e.g. signatures).
   * @param meta the template's normalized meta (all keys present)
   * @param context the order-scoped Latte data (`report_tests`, `header_fields`)
   * @param images uploaded/registry id → src map (merged over `meta.images`)
   */
  render(
    meta: PdfTemplateMeta,
    context: Record<string, unknown>,
    images: Record<string, string> = {},
  ): PreparedPdfHtml {
    const merged = { ...(meta.images ?? {}), ...images };
    const header = this.transformMpdfTags(
      renderLatte(resolveImageTokens(meta.header_html, merged), context),
    );
    const body = this.transformMpdfTags(
      renderLatte(resolveImageTokens(meta.body_html, merged), context),
    );
    const footer = this.transformMpdfTags(
      renderLatte(resolveImageTokens(meta.footer_html, merged), context),
    );
    return buildPdfDocuments(meta, header, body, footer);
  }

  /**
   * Render ONLY the template's interpolated body fragment via Latte (no page
   * wrapper / header / footer) — the Latte counterpart of
   * `TemplateRenderService.renderBodyFragment`. Used to build a single test's
   * `body_html` for a Lab All Report when that test's `lab_report` template is
   * authored in Latte, so its `{foreach}`/`{if}`/`{var}` conditionals (hide an
   * empty section, drop the Method column, per-group sub-headers, hide a test
   * with no values) run as written against the per-test `$tests`/`$test`
   * context. The template's `custom_css` is prefixed so its styling survives
   * embedding in the combined document.
   * @param meta the single-test template's normalized meta (all keys present)
   * @param data the per-test Latte context (`tests[0]` = this test + approver)
   * @param images uploaded/registry id → src map (merged over `meta.images`)
   */
  renderBodyFragment(
    meta: PdfTemplateMeta,
    data: Record<string, unknown>,
    images: Record<string, string> = {},
  ): string {
    const merged = { ...(meta.images ?? {}), ...images };
    const body = this.transformMpdfTags(
      renderLatte(resolveImageTokens(meta.body_html, merged), data),
    );
    const css = meta.custom_css?.trim()
      ? `<style>${meta.custom_css}</style>`
      : '';
    return `${css}${body}`;
  }

  /**
   * Translate mPDF running-header markup into Puppeteer-friendly inline HTML:
   *  - `<htmlpageheader name=…>INNER</htmlpageheader>` → the INNER block emitted
   *    inline where it was declared (so each test's header sits atop its page).
   *  - `<sethtmlpageheader …/>` (self-closing or paired) → removed (no-op).
   * `page-break-after:always` divs in the template are left untouched — Chromium
   * paginates on them, giving each test its own page(s). (Limitation: if a
   * single test's body overflows to a second physical page the header will not
   * repeat on the overflow page, unlike mPDF.)
   */
  private transformMpdfTags(html: string): string {
    let out = html.replace(
      /<htmlpageheader\b[^>]*>([\s\S]*?)<\/htmlpageheader>/gi,
      (_m, inner: string) => `<div class="report-page-header">${inner}</div>`,
    );
    out = out.replace(/<sethtmlpageheader\b[^>]*?\/?>/gi, '');
    out = out.replace(/<\/sethtmlpageheader>/gi, '');
    return out;
  }
}
