import { LabReportService } from './lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { TemplateRenderService } from '../pdf-report-template/services/template-render.service';
import { LatteReportRenderService } from '../pdf-report-template/services/latte-render.service';

/**
 * A Qualitative result written over several lines keeps those lines when a test's report body is built for
 * Lab All Report: for the test's own flat template and for the built-in fallback (no usable template).
 * Uses the real template services (only the DB lookup is stubbed), like the other all-report specs.
 */
const THREE_LINES =
  'Pus cells 8-10 /hpf\nEpithelial cells 2-3 /hpf\nNo casts seen';
const THREE_LINES_HTML =
  'Pus cells 8-10 /hpf<br />Epithelial cells 2-3 /hpf<br />No casts seen';

const contextWith = (observed1: string) => ({
  variables: { test_name: 'Urine R/E' },
  sections: {
    results: [
      {
        parameter_name: 'Microscopy',
        observed1,
        unit: '',
        methodology: '',
        reference_display: '',
        group_name: '',
        result_note: '',
        overall_result: '',
      },
    ],
  },
});

function build(bodyHtml: string | null, observed1: string) {
  const prisma = {
    pdfReportTemplate: {
      findFirst: jest.fn().mockResolvedValue(
        bodyHtml === null
          ? null
          : {
              id: 'tpl1',
              tenantId: 't1',
              meta: { body_html: bodyHtml, custom_css: '' },
            },
      ),
    },
    printTemplateImage: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const pdfService = new PdfReportTemplateService(
    prisma as never,
    undefined as never,
    undefined as never,
    new TemplateRenderService(),
    new LatteReportRenderService(),
  );
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = prisma;
  deps[1] = pdfService;
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const priv = service as unknown as {
    resolvePrintTemplateId: () => Promise<string>;
    getTestReportTemplateId: () => Promise<string | null>;
    buildReportBodyHtml: (
      id: string,
      t: string,
      b: string | null,
      ctx: unknown,
    ) => Promise<string>;
  };
  jest.spyOn(priv, 'resolvePrintTemplateId').mockResolvedValue('tpl1');
  jest.spyOn(priv, 'getTestReportTemplateId').mockResolvedValue(null);
  return (): Promise<string> =>
    priv.buildReportBodyHtml('r1', 't1', 'b1', contextWith(observed1));
}

describe('Lab All Report keeps the line breaks of a multi-line Qualitative result', () => {
  it('flat single-report template', async () => {
    const body = await build(
      '{{#each results}}<td>{observed1}</td>{{/each}}',
      THREE_LINES,
    )();
    expect(body).toContain(`<td>${THREE_LINES_HTML}</td>`);
  });

  it('built-in fallback when the test has no usable template', async () => {
    const body = await build(null, THREE_LINES)();
    expect(body).toContain(`<td>${THREE_LINES_HTML}</td>`);
  });

  it('the built-in fallback still escapes the value', async () => {
    const body = await build(null, '<b>bold</b>\nnext')();
    expect(body).toContain('<td>&lt;b&gt;bold&lt;/b&gt;<br />next</td>');
    expect(body).not.toContain('<b>bold');
  });

  it('a one-line value is unchanged', async () => {
    const flat = await build(
      '{{#each results}}<td>{observed1}</td>{{/each}}',
      'Positive',
    )();
    const fallback = await build(null, 'Positive')();
    expect(flat).toContain('<td>Positive</td>');
    expect(fallback).toContain('<td>Positive</td>');
    expect(flat).not.toContain('<br');
  });
});
