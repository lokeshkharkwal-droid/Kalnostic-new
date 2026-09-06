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
});
