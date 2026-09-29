import { LatteReportRenderService } from './latte-render.service';
import {
  PdfTemplateMeta,
  PDF_TEMPLATE_META_DEFAULTS,
} from '../constants/pdf-template-meta.constant';

/** Build a complete meta from a partial override (all keys present). */
function meta(partial: Partial<PdfTemplateMeta>): PdfTemplateMeta {
  return { ...PDF_TEMPLATE_META_DEFAULTS, ...partial };
}

describe('LatteReportRenderService — {{image:ID}} on the Latte path', () => {
  const service = new LatteReportRenderService();

  it('resolves an uploaded/registry image token in a Latte-bodied template header', () => {
    // Body is Latte (`{$...}`), so the whole template renders through this
    // engine; the flat header logo must still resolve to a real <img>.
    const prepared = service.render(
      meta({
        header_html: '<div>{{image:New_Hedder_-_Copy_5c25c5.png}}</div>',
        body_html: '<p>{$patient_name}</p>',
      }),
      { patient_name: 'Jane' },
      { 'New_Hedder_-_Copy_5c25c5.png': 'https://cdn.example.com/logo.png' },
    );
    expect(prepared.headerTemplate).toContain(
      'src="https://cdn.example.com/logo.png"',
    );
    // The broken Latte-variable rewrite must NOT leak through.
    expect(prepared.headerTemplate).not.toContain('{$New_Hedder');
    expect(prepared.headerTemplate).not.toContain('{{image:');
  });

  it('resolves an image token from meta.images without a runtime map', () => {
    const prepared = service.render(
      meta({
        header_html: '{{image:logo-a.png}}',
        body_html: '<p>{$x}</p>',
        images: { 'logo-a.png': 'https://cdn.example.com/a.png' },
      }),
      {},
    );
    expect(prepared.headerTemplate).toContain('src="https://cdn.example.com/a.png"');
  });

  it('leaves an UNresolved token for the {$ID} context fallback (e.g. a signature URL)', () => {
    // `report_approved_by_signature` is not an uploaded image — it comes from the
    // Latte context, so the {{image}}→{$ID} fallback must still apply.
    const prepared = service.render(
      meta({
        header_html: '<span>x</span>',
        footer_html: '{{image:report_approved_by_signature}}',
        body_html: '<p>{$x}</p>',
      }),
      { report_approved_by_signature: 'https://cdn.example.com/sig.png' },
    );
    expect(prepared.footerTemplate).toContain('src="https://cdn.example.com/sig.png"');
  });
});
