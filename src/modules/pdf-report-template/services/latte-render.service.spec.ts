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
    expect(prepared.headerTemplate).toContain(
      'src="https://cdn.example.com/a.png"',
    );
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
    expect(prepared.footerTemplate).toContain(
      'src="https://cdn.example.com/sig.png"',
    );
  });

  it('sizes a context-fallback signature via the |w=…,h=… suffix on the Latte path', () => {
    const prepared = service.render(
      meta({
        header_html: '<span>x</span>',
        footer_html: '{{image:report_approved_by_signature|w=120,h=60}}',
        body_html: '<p>{$x}</p>',
      }),
      { report_approved_by_signature: 'https://cdn.example.com/sig.png' },
    );
    expect(prepared.footerTemplate).toContain(
      'src="https://cdn.example.com/sig.png"',
    );
    expect(prepared.footerTemplate).toContain(
      'style="width:120px;height:60px"',
    );
  });
});

describe('LatteReportRenderService — barcode image tags', () => {
  const service = new LatteReportRenderService();
  const ORDER_SRC = 'data:image/png;base64,T1JERVI=';
  const SAMPLE_SRC = 'data:image/png;base64,U0FNUExF';
  // `buildTestLatteContext` spreads the flat variables at the root; the
  // runtime images map carries the same srcs.
  const data = {
    patient_name: 'Jane',
    order_id_barcode: ORDER_SRC,
    order_id_qr_code: SAMPLE_SRC,
  };
  const images = { order_id_barcode: ORDER_SRC, order_id_qr_code: SAMPLE_SRC };

  it('renders a bare tag in text as an <img> instead of raw data-URI text', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html: '<p>{$patient_name}</p><div>{order_id_qr_code}</div>',
      }),
      data,
      images,
    );
    expect(html).toContain(
      `<div><img src="${SAMPLE_SRC}" alt="order_id_qr_code" /></div>`,
    );
  });

  it('fills <img src="{tag}"> and {{image:tag}} with the same src', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html:
          '<p>{$patient_name}</p><img src="{order_id_barcode}" alt="x">{{image:order_id_barcode}}',
      }),
      data,
      images,
    );
    expect(html).toContain(`<img src="${ORDER_SRC}" alt="x">`);
    expect(html).toContain(`<img src="${ORDER_SRC}" alt="order_id_barcode" />`);
    expect(html).not.toContain(SAMPLE_SRC);
  });

  it('renders bare barcode tags in a Latte template header', () => {
    const prepared = service.render(
      meta({
        header_html: '<span>{order_id_barcode}</span>',
        body_html: '<p>{$patient_name}</p>',
      }),
      data,
      images,
    );
    expect(prepared.headerTemplate).toContain(
      `<span><img src="${ORDER_SRC}" alt="order_id_barcode" /></span>`,
    );
  });
});
