/**
 * Advance PDF renderer entry point.
 *
 * Pipeline: AdvanceDocument JSON + AdvanceContext data → HTML → Puppeteer → PDF.
 *
 *   - Page settings (size, orientation, margins, background) drive the
 *     `@page` CSS and Puppeteer options.
 *   - Header / Footer regions become Puppeteer's `headerTemplate` /
 *     `footerTemplate` so they tile per page automatically.
 *   - Body blocks render into the document flow; page breaks happen
 *     either via natural overflow or via `page-break` blocks.
 */

import type { PDFOptions } from 'puppeteer';
import type { AdvanceDocument } from './types';
import { renderBlocks, type RenderEnv } from './block-renderers';
import type { ResolverCtx } from './token-resolver';

export interface RenderInput {
  doc: AdvanceDocument;
  context: Record<string, unknown>;
}

/**
 * Build the full HTML document + Puppeteer `PDFOptions` for a template. The
 * actual HTML→PDF step is delegated to the shared `PdfService`
 * (kalnostics-new) so we do not maintain a second browser pool. Header /
 * footer regions become Puppeteer `headerTemplate` / `footerTemplate` so
 * they tile per page automatically.
 */
export function buildAdvancePdfRender(input: RenderInput): {
  html: string;
  options: PDFOptions;
} {
  const { doc, context } = input;
  const ctx: ResolverCtx = { root: context, loops: [] };
  const env: RenderEnv = { ctx, theme: doc.theme };

  const bodyHtml = renderBlocks(doc.body.blocks, env);
  const headerHtml =
    doc.header.blocks.length > 0 ? renderBlocks(doc.header.blocks, env) : '';
  const footerHtml =
    doc.footer.blocks.length > 0 ? renderBlocks(doc.footer.blocks, env) : '';

  const html = wrapDocument(doc, bodyHtml);
  // Puppeteer's header/footer render in their own contexts and get their
  // own minimal HTML wrappers — defaults need to be injected here too
  // since they don't inherit page CSS.
  const wrappedHeader = headerHtml ? wrapHeaderFooter(doc, headerHtml) : '';
  const wrappedFooter = footerHtml ? wrapHeaderFooter(doc, footerHtml) : '';

  const options: PDFOptions = {
    format: doc.page.size,
    landscape: doc.page.orientation === 'landscape',
    margin: doc.page.margins,
    printBackground: true,
    displayHeaderFooter: !!(wrappedHeader || wrappedFooter),
    headerTemplate: wrappedHeader || '<span></span>',
    footerTemplate: wrappedFooter || '<span></span>',
  };
  return { html, options };
}

/**
 * Render the document HTML to a string (used by the editor preview).
 * The header and footer regions are emitted as labelled bands above /
 * below the body so authors can see them in context — Puppeteer
 * renders them in a separate CSS context for the actual PDF, so this
 * preview is a layout aid, not pixel-accurate. Click "Open PDF" in
 * the editor toolbar for the real rendering.
 */
export function renderAdvanceDocumentToHtml(input: RenderInput): string {
  const { doc, context } = input;
  const ctx: ResolverCtx = { root: context, loops: [] };
  const env: RenderEnv = { ctx, theme: doc.theme };

  const headerInner = renderBlocks(doc.header.blocks, env);
  const footerInner = renderBlocks(doc.footer.blocks, env);
  const bodyInner = renderBlocks(doc.body.blocks, env);

  const placeholder =
    '<div class="pdfv2-preview-empty">No blocks — add to this region from the tree on the left.</div>';
  const region = (
    id: string,
    label: string,
    content: string,
    isEmpty: boolean,
  ) => `
    <section id="pdfv2-region-${id}" class="pdfv2-region pdfv2-preview-band${isEmpty ? ' pdfv2-preview-band-empty' : ''}">
      <div class="pdfv2-preview-band-label">${label}</div>
      <div class="pdfv2-preview-band-body">${isEmpty ? placeholder : content}</div>
    </section>
  `;

  const composite = `
    ${region('header', 'HEADER — repeats on every page', headerInner, doc.header.blocks.length === 0)}
    ${region('body', 'BODY', bodyInner, doc.body.blocks.length === 0)}
    ${region('footer', 'FOOTER — repeats on every page', footerInner, doc.footer.blocks.length === 0)}
  `;
  return wrapDocument(doc, composite);
}

// ─── HTML wrappers ──────────────────────────────────────────────────────

function wrapDocument(doc: AdvanceDocument, body: string): string {
  const bg = doc.page.background;
  const bgCss = bg
    ? bg.image
      ? `background-image:url('${bg.image}'); background-size:${bg.fit ?? 'cover'}; background-position:center; background-repeat:no-repeat;`
      : bg.color
        ? `background:${bg.color};`
        : ''
    : '';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        font-family: ${doc.page.default_font.family}, system-ui, -apple-system, sans-serif;
        font-size: ${doc.page.default_font.size}pt;
        color: ${doc.page.default_font.color};
        ${bgCss}
      }
      h1, h2, h3, h4, p { margin: 0; }
      table { border-spacing: 0; }

      /* Page-break behaviour for Puppeteer/Chromium PDF.
         - Tables: thead repeats on every page (table-header-group),
           rows refuse to split across pages so result lines stay legible.
         - Containers (section / repeat-iteration / conditional / kv) avoid
           internal breaks so a "Patient" or "Order header" group never
           gets cut in half. */
      table         { page-break-inside: auto; break-inside: auto; }
      thead         { display: table-header-group; }
      tfoot         { display: table-footer-group; }
      tr            { page-break-inside: avoid; break-inside: avoid; }
      .pdfv2-section,
      .pdfv2-repeat-item,
      .pdfv2-conditional,
      .pdfv2-kv      { page-break-inside: avoid; break-inside: avoid; }

      /* Editor-preview-only chrome — the live HTML preview wraps the
         header and footer in labelled bands so authors can see those
         regions in context. The rules are scoped to .pdfv2-preview-*
         so they only apply to the editor preview path; the Puppeteer
         PDF render uses headerTemplate / footerTemplate and never
         emits these bands. */
      .pdfv2-preview-band {
        position: relative;
        border: 1px dashed #94a3b8;
        background: rgba(148, 163, 184, 0.06);
        margin: 12px 0 8px 0;
        padding: 22px 18px 16px 18px;
        border-radius: 4px;
      }
      .pdfv2-preview-band-body { padding: 4px 0; }
      .pdfv2-preview-band-label {
        position: absolute;
        top: -8px; left: 8px;
        font-size: 8pt; line-height: 1;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #475569;
        background: #ffffff;
        padding: 0 6px;
      }
      .pdfv2-region { scroll-margin-top: 12px; }
      /* :target CSS lights up whichever region the URL fragment points
         at — the editor sets the iframe hash to '#pdfv2-region-<name>'
         when the user clicks Header / Body / Footer in the palette. */
      .pdfv2-region:target {
        border: 1.5px solid #0ea5e9;
        background: rgba(14, 165, 233, 0.06);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
      }
      .pdfv2-region:target .pdfv2-preview-band-label {
        color: #0369a1;
      }
      .pdfv2-preview-band-empty {
        background: rgba(148, 163, 184, 0.04);
        border-style: dotted;
      }
      .pdfv2-preview-empty {
        font-size: 9pt;
        color: #94a3b8;
        font-style: italic;
        text-align: center;
        padding: 6px 0;
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function wrapHeaderFooter(doc: AdvanceDocument, content: string): string {
  // Puppeteer renders header/footer at very small default font; we
  // override with the document's defaults. `width:100%` is the trick
  // that makes header/footer take the full page width.
  return `<div style="
    width:100%;
    font-family:${doc.page.default_font.family};
    font-size:${Math.max(8, doc.page.default_font.size - 2)}pt;
    color:${doc.page.default_font.color};
    -webkit-print-color-adjust:exact;
    padding:0 ${doc.page.margins.left} 0 ${doc.page.margins.left};
  ">${content}</div>`;
}
