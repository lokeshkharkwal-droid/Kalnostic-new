import { Injectable } from '@nestjs/common';
import { PdfTemplateMeta } from '../constants/pdf-template-meta.constant';
import { PreparedPdfHtml, buildPdfDocuments } from './pdf-document.util';
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
   * @param meta the template's normalized meta (all keys present)
   * @param context the order-scoped Latte data (`report_tests`, `header_fields`)
   */
  render(
    meta: PdfTemplateMeta,
    context: Record<string, unknown>,
  ): PreparedPdfHtml {
    const header = this.transformMpdfTags(
      renderLatte(meta.header_html, context),
    );
    const body = this.transformMpdfTags(renderLatte(meta.body_html, context));
    const footer = this.transformMpdfTags(
      renderLatte(meta.footer_html, context),
    );
    return buildPdfDocuments(meta, header, body, footer);
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
