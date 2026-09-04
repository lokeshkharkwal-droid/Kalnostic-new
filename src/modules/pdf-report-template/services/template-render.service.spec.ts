import { TemplateRenderService } from './template-render.service';
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
    const html = service.render(
      meta({
        body_html: 'Logo: {{image:abc-uuid.png}}',
        images: { 'abc-uuid.png': 'https://cdn.example/abc-uuid.png' },
      }),
      emptyCtx,
    );
    expect(html).toContain('<img src="https://cdn.example/abc-uuid.png"');
    expect(html).not.toContain('{{image:abc-uuid.png}}');
  });

  it('resolves {{image:<id>}} in header and footer too', () => {
    const html = service.render(
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
    expect(html).toContain('https://cdn.example/h.png');
    expect(html).toContain('https://cdn.example/f.png');
  });

  it('lets a generate-time context.images override the meta registry', () => {
    const html = service.render(
      meta({
        body_html: '{{image:x.png}}',
        images: { 'x.png': 'https://cdn.example/from-meta.png' },
      }),
      { images: { 'x.png': 'https://cdn.example/from-context.png' } },
    );
    expect(html).toContain('https://cdn.example/from-context.png');
    expect(html).not.toContain('from-meta.png');
  });

  it('renders an image watermark that takes precedence over watermark_text', () => {
    const html = service.render(
      meta({
        watermark_text: 'DRAFT',
        watermark_image: 'https://cdn.example/wm.png',
      }),
      emptyCtx,
    );
    expect(html).toContain('pdf-watermark-image');
    expect(html).toContain('https://cdn.example/wm.png');
    // The text watermark div must not be emitted when an image is present.
    expect(html).not.toContain('<div class="pdf-watermark">');
  });

  it('still renders the text watermark when no image is set (backward compatible)', () => {
    const html = service.render(meta({ watermark_text: 'CONFIDENTIAL' }), emptyCtx);
    expect(html).toContain('<div class="pdf-watermark">CONFIDENTIAL</div>');
    // The image-watermark element must not be emitted (the `.pdf-watermark-image`
    // CSS rule is always present in the stylesheet, so assert on the div).
    expect(html).not.toContain('<div class="pdf-watermark-image">');
  });

  it('collapses an unknown {{image:<id>}} to empty (unchanged behaviour)', () => {
    const html = service.render(meta({ body_html: 'X{{image:missing.png}}Y' }), emptyCtx);
    expect(html).toContain('XY');
    expect(html).not.toContain('missing.png');
  });
});
