import {
  TemplateRenderService,
  extractImageTokens,
} from './template-render.service';
import {
  PDF_TEMPLATE_META_DEFAULTS,
  PdfTemplateMeta,
} from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

/** Build a complete meta from defaults plus overrides. */
function meta(overrides: Partial<PdfTemplateMeta>): PdfTemplateMeta {
  return { ...PDF_TEMPLATE_META_DEFAULTS, ...overrides };
}

describe('TemplateRenderService — images & watermark', () => {
  const service = new TemplateRenderService();
  const emptyCtx: GeneratePdfDto = {};

  it('resolves {{image:<id>}} in the body from the meta.images registry (dotted id)', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: 'Logo: {{image:abc-uuid.png}}',
        images: { 'abc-uuid.png': 'https://cdn.example/abc-uuid.png' },
      }),
      emptyCtx,
    );
    expect(bodyHtml).toContain('<img src="https://cdn.example/abc-uuid.png"');
    expect(bodyHtml).not.toContain('{{image:abc-uuid.png}}');
  });

  it('resolves {{image:<id>}} in the header and footer templates too', () => {
    const { headerTemplate, footerTemplate } = service.render(
      meta({
        header_html: '{{image:h.png}}',
        footer_html: '{{image:f.png}}',
        images: {
          'h.png': 'https://cdn.example/h.png',
          'f.png': 'https://cdn.example/f.png',
        },
      }),
      emptyCtx,
    );
    // Header/footer are rendered by Puppeteer in the page margins, so their
    // resolved images live in the header/footer TEMPLATES, not the body document.
    expect(headerTemplate).toContain('https://cdn.example/h.png');
    expect(footerTemplate).toContain('https://cdn.example/f.png');
  });

  it('lets a generate-time context.images override the meta registry', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: '{{image:x.png}}',
        images: { 'x.png': 'https://cdn.example/from-meta.png' },
      }),
      { images: { 'x.png': 'https://cdn.example/from-context.png' } },
    );
    expect(bodyHtml).toContain('https://cdn.example/from-context.png');
    expect(bodyHtml).not.toContain('from-meta.png');
  });

  it('renders an image watermark that takes precedence over watermark_text', () => {
    const { bodyHtml } = service.render(
      meta({
        watermark_text: 'DRAFT',
        watermark_image: 'https://cdn.example/wm.png',
      }),
      emptyCtx,
    );
    expect(bodyHtml).toContain('pdf-watermark-image');
    expect(bodyHtml).toContain('https://cdn.example/wm.png');
    // The text watermark div must not be emitted when an image is present.
    expect(bodyHtml).not.toContain('<div class="pdf-watermark">');
  });

  it('still renders the text watermark when no image is set (backward compatible)', () => {
    const { bodyHtml } = service.render(
      meta({ watermark_text: 'CONFIDENTIAL' }),
      emptyCtx,
    );
    expect(bodyHtml).toContain('<div class="pdf-watermark">CONFIDENTIAL</div>');
    // The image-watermark element must not be emitted (the `.pdf-watermark-image`
    // CSS rule is always present in the stylesheet, so assert on the div).
    expect(bodyHtml).not.toContain('<div class="pdf-watermark-image">');
  });

  it('collapses an unknown {{image:<id>}} to empty (unchanged behaviour)', () => {
    const { bodyHtml } = service.render(
      meta({ body_html: 'X{{image:missing.png}}Y' }),
      emptyCtx,
    );
    expect(bodyHtml).toContain('XY');
    expect(bodyHtml).not.toContain('missing.png');
  });

  it('applies a width-only {{image:<id>|w=120}} suffix as an inline style (px default)', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: '{{image:sig.png|w=120}}',
        images: { 'sig.png': 'https://cdn.example/sig.png' },
      }),
      emptyCtx,
    );
    expect(bodyHtml).toContain(
      '<img src="https://cdn.example/sig.png" alt="sig.png" style="width:120px" />',
    );
  });

  it('applies both width and height from {{image:<id>|w=120,h=60}}', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: '{{image:sig.png|w=120,h=60}}',
        images: { 'sig.png': 'https://cdn.example/sig.png' },
      }),
      emptyCtx,
    );
    expect(bodyHtml).toContain('style="width:120px;height:60px"');
  });

  it('honours an explicit CSS unit and ignores unknown/invalid size parts', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: '{{image:sig.png|width=40%,foo=bar,h=abc}}',
        images: { 'sig.png': 'https://cdn.example/sig.png' },
      }),
      emptyCtx,
    );
    // Only the valid width survives; the bad key (`foo=bar`) and non-numeric
    // height (`h=abc`) are dropped — assert on the exact emitted <img> so page
    // CSS elsewhere in the document can't create false matches.
    expect(bodyHtml).toContain(
      '<img src="https://cdn.example/sig.png" alt="sig.png" style="width:40%" />',
    );
  });

  it('emits no style attribute for a plain {{image:<id>}} (backward compatible)', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: '{{image:sig.png}}',
        images: { 'sig.png': 'https://cdn.example/sig.png' },
      }),
      emptyCtx,
    );
    expect(bodyHtml).toContain('alt="sig.png" />');
    expect(bodyHtml).not.toContain('style=');
  });
});

describe('extractImageTokens', () => {
  it('collects distinct token ids across header/body/footer (first-seen order)', () => {
    const ids = extractImageTokens(
      'H {{image:a.png}}',
      'B {{image:b.png}} {{image:a.png}}',
      'F {{image:c.png}}',
    );
    expect(ids).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('ignores undefined/empty fragments and returns [] when there are no tokens', () => {
    expect(extractImageTokens(undefined, '', 'plain text, no tokens')).toEqual(
      [],
    );
  });

  it('collects the id and ignores a |w=…,h=… sizing suffix', () => {
    const ids = extractImageTokens(
      '{{image:a.png|w=120}} {{image:b.png|w=80,h=40}} {{image:a.png}}',
    );
    expect(ids).toEqual(['a.png', 'b.png']);
  });
});

describe('TemplateRenderService — header/footer as repeating page templates', () => {
  const service = new TemplateRenderService();

  it('emits header/footer as Puppeteer templates and only the body in bodyHtml', () => {
    const prepared = service.render(
      meta({
        header_html: 'HEAD',
        body_html: 'BODY',
        footer_html: 'FOOT',
      }),
      {},
    );
    // Header/footer live in their own templates (Chromium repeats them on every
    // page, pinned to the top/bottom margins); the body document has neither.
    expect(prepared.headerTemplate).toContain('<div class="pdf-header"');
    expect(prepared.headerTemplate).toContain('HEAD');
    expect(prepared.footerTemplate).toContain('<div class="pdf-footer"');
    expect(prepared.footerTemplate).toContain('FOOT');
    expect(prepared.bodyHtml).toContain('<div class="pdf-body">BODY</div>');
    expect(prepared.bodyHtml).not.toContain('HEAD');
    expect(prepared.bodyHtml).not.toContain('FOOT');
    // Templates are self-contained (own <style>) since Chromium renders them in
    // an isolated context that doesn't inherit the body stylesheet.
    expect(prepared.headerTemplate).toContain('<style>');
    expect(prepared.hasHeaderFooter).toBe(true);
  });

  it('reports hasHeaderFooter=false when neither header nor footer has content', () => {
    const prepared = service.render(meta({ body_html: 'ONLY BODY' }), {});
    expect(prepared.hasHeaderFooter).toBe(false);
    expect(prepared.bodyHtml).toContain('ONLY BODY');
  });
});

describe('TemplateRenderService — header/footer as natural-height flow templates', () => {
  const service = new TemplateRenderService();

  it('insets header content by the margin_header gap as top padding (edge side only)', () => {
    const { headerTemplate } = service.render(
      // margin_left 15 / margin_right 10 (defaults), margin_header 8.
      meta({ header_html: 'H', margin_header: '8' }),
      {},
    );
    // Natural-height flow box: gap padding on the PAGE-EDGE side (top) only, and
    // the body-facing side (bottom) is `0` — the page margin is grown to fit at
    // print time (PdfService), so the wrapper has no fixed height and no clipping.
    expect(headerTemplate).toContain(
      '<div class="pdf-header" style="box-sizing: border-box; width: 100%; padding: 8mm 10mm 0 15mm;',
    );
  });

  it('insets footer content by the margin_footer gap as bottom padding', () => {
    const { footerTemplate } = service.render(
      meta({ footer_html: 'F', margin_footer: '6' }),
      {},
    );
    expect(footerTemplate).toContain(
      '<div class="pdf-footer" style="box-sizing: border-box; width: 100%; padding: 0 10mm 6mm 15mm;',
    );
  });

  it('scales header/footer images to the page width without crushing their height', () => {
    const { headerTemplate } = service.render(
      meta({
        header_html: '{{image:l.png}}',
        margin_top: '10',
        margin_header: '5',
      }),
      { images: { 'l.png': 'https://cdn.example/l.png' } },
    );
    // Images keep their natural aspect ratio (`height: auto`, no band-height cap):
    // the page margin grows to fit, so a real letterhead is never squashed.
    expect(headerTemplate).toContain(
      '.pdf-header img { max-width: 100%; height: auto; }',
    );
    expect(headerTemplate).not.toContain('object-fit');
  });

  it('constrains wide tables and long words inside the header', () => {
    const { headerTemplate } = service.render(
      meta({ header_html: '<table><tr><td>x</td></tr></table>' }),
      {},
    );
    expect(headerTemplate).toContain('.pdf-header table');
    expect(headerTemplate).toContain('table-layout: fixed;');
    expect(headerTemplate).toContain('overflow-wrap: break-word;');
  });
});

describe('TemplateRenderService — case-insensitive tokens', () => {
  const service = new TemplateRenderService();

  it('resolves UPPERCASE tags against lowercase context keys (legacy bill tags)', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html:
          '<p>{PAYMENT_COLLECTED_BY}|{DISCOUNT_AMOUNT}|{DISCOUNT_PERCENTAGE}%|{BALANCE_AMOUNT}|{UNKNOWN_TAG}</p>',
      }),
      {
        variables: {
          payment_collected_by: 'Asha',
          discount_amount: 150,
          discount_percentage: 10,
          balance_amount: 50,
        },
      },
    );
    expect(bodyHtml).toContain('Asha|150|10%|50|');
    // A genuinely unknown token stays literal (surfaces real typos).
    expect(bodyHtml).toContain('{UNKNOWN_TAG}');
  });

  it('keeps exact lowercase tags working (backward compatible)', () => {
    const { bodyHtml } = service.render(
      meta({ body_html: '<p>{balance_amount}</p>' }),
      { variables: { balance_amount: 99 } },
    );
    expect(bodyHtml).toContain('<p>99</p>');
  });

  it('is case-insensitive inside {{#each}} section rows too', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html: '<ul>{{#each items}}<li>{NAME}={PRICE}</li>{{/each}}</ul>',
      }),
      { sections: { items: [{ name: 'CBC', price: 300 }] } },
    );
    expect(bodyHtml).toContain('<li>CBC=300</li>');
  });

  it('resolves dotted legacy tags as one flat key ({ORDER.DATE} → order.date)', () => {
    // The referral patient bill emits `signature_name` + a flat `order.date`
    // alias; the engine matches the dotted token literally, never as a path.
    const { footerTemplate, bodyHtml } = service.render(
      meta({
        body_html: '<p>{ORDER.DATE}</p>',
        footer_html: '<p>{SIGNATURE_NAME}</p>',
      }),
      {
        variables: {
          'order.date': '10/09/2026',
          signature_name: 'Branch Admin',
        },
      },
    );
    expect(bodyHtml).toContain('<p>10/09/2026</p>');
    expect(footerTemplate).toContain('<p>Branch Admin</p>');
  });

  it('leaves {ORDER.DATE}/{SIGNATURE_NAME} literal on contexts without those keys', () => {
    // e.g. a plain bill_print context, which only carries `order_date`.
    const { bodyHtml } = service.render(
      meta({ body_html: '<p>{ORDER.DATE}|{SIGNATURE_NAME}</p>' }),
      { variables: { order_date: '10/09/2026' } },
    );
    expect(bodyHtml).toContain('<p>{ORDER.DATE}|{SIGNATURE_NAME}</p>');
  });

  it('resolves the lab quotation legacy tags, with per-row item aliases inside {{#each items}}', () => {
    // Shape emitted by `OrderService.buildQuotationContext`: flat dotted
    // aliases at the top level, `item.*` aliases on each row.
    const { headerTemplate, bodyHtml } = service.render(
      meta({
        header_html: '<p>{EXT_QUOTE_ID}</p>',
        body_html:
          '<p>{PATIENT.FULL_NAME}|{ORDER.REFERRING_DOCTOR}|{ORDER.REFERRING_PANEL}</p>' +
          '<table>{{#each items}}<tr><td>{ITEM.INDEX}</td><td>{ITEM.NAME}</td>' +
          '<td>{panel_tests_name}</td><td>{item.price}</td></tr>{{/each}}</table>' +
          '<p>Total {BILL.TOTAL}</p>',
      }),
      {
        variables: {
          ext_quote_id: 'QT-0042',
          'patient.full_name': 'Asha Verma',
          'order.referring_doctor': 'Rohit Sharma',
          'order.referring_panel': 'Apollo Panel',
          'bill.total': 1550,
          panel_tests_name: 'RA Factor, KFT',
        },
        sections: {
          items: [
            {
              'item.index': 1,
              'item.name': 'CBC',
              'item.price': 300,
              panel_tests_name: '',
            },
            {
              'item.index': 2,
              'item.name': 'Health Panel',
              'item.price': 1200,
              panel_tests_name: 'RA Factor, KFT',
            },
          ],
        },
      },
    );
    expect(headerTemplate).toContain('<p>QT-0042</p>');
    expect(bodyHtml).toContain('<p>Asha Verma|Rohit Sharma|Apollo Panel</p>');
    // Each row carries its own values — a test row's empty panel list must not
    // fall back to the quote-wide flat `panel_tests_name`.
    expect(bodyHtml).toContain(
      '<tr><td>1</td><td>CBC</td><td></td><td>300</td></tr>' +
        '<tr><td>2</td><td>Health Panel</td><td>RA Factor, KFT</td><td>1200</td></tr>',
    );
    expect(bodyHtml).toContain('<p>Total 1550</p>');
  });
});

describe('TemplateRenderService — renderBodyFragment (lab_all_report body)', () => {
  const service = new TemplateRenderService();

  it('returns only the interpolated body fragment (no page/document wrapper)', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html:
          '<div class="report-test">{test_name}</div>' +
          '<table><tbody>{{#each results}}<tr><td>{parameter_name}</td><td>{observed1}</td></tr>{{/each}}</tbody></table>',
        header_html: 'HEADER SHOULD NOT APPEAR',
        footer_html: 'FOOTER SHOULD NOT APPEAR',
      }),
      {
        variables: { test_name: 'Serum Glucose' },
        sections: {
          results: [{ parameter_name: 'Glucose', observed1: '120' }],
        },
      },
    );
    // Body content is interpolated…
    expect(html).toContain('<div class="report-test">Serum Glucose</div>');
    expect(html).toContain('<tr><td>Glucose</td><td>120</td></tr>');
    // …but there is NO full-document wrapper and NO header/footer content, so
    // the fragment can be embedded per-test inside the all-reports document.
    expect(html).not.toContain('<!DOCTYPE');
    expect(html).not.toContain('pdf-body');
    expect(html).not.toContain('HEADER SHOULD NOT APPEAR');
    expect(html).not.toContain('FOOTER SHOULD NOT APPEAR');
  });

  it('prefixes the template custom_css so per-report styling survives embedding', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html: '<div>{test_name}</div>',
        custom_css: '.report-test { color: red; }',
      }),
      { variables: { test_name: 'CBC' } },
    );
    expect(html).toContain('<style>.report-test { color: red; }</style>');
    expect(html).toContain('<div>CBC</div>');
  });

  it('resolves {{image:<id>}} in the body fragment from the meta registry', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html: 'Sig: {{image:sign.png}}',
        images: { 'sign.png': 'https://cdn.example/sign.png' },
      }),
      {},
    );
    expect(html).toContain('<img src="https://cdn.example/sign.png"');
  });
});

describe('TemplateRenderService — {test_file_attachment}', () => {
  const service = new TemplateRenderService();
  const embed =
    '<div class="test-file-attachment"><embed src="https://cdn/a.pdf?x=1&amp;y=2" type="application/pdf" title="a.pdf" /></div>';

  it('inserts the server-built <embed> markup unescaped', () => {
    const { bodyHtml } = service.render(
      meta({ body_html: '<h2>{test_name}</h2>{test_file_attachment}' }),
      {
        variables: {
          test_name: 'CBC <Complete>',
          test_file_attachment: embed,
        },
      },
    );
    expect(bodyHtml).toContain(embed);
    // Every other key is still escaped.
    expect(bodyHtml).toContain('CBC &lt;Complete&gt;');
  });

  it('is unescaped per row inside {{#each reports}} too', () => {
    const { bodyHtml } = service.render(
      meta({ body_html: '{{#each reports}}[{test_file_attachment}]{{/each}}' }),
      { sections: { reports: [{ test_file_attachment: embed }] } },
    );
    expect(bodyHtml).toContain(`[${embed}]`);
  });
});
