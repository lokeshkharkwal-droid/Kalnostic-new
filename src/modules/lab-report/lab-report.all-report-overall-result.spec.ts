import { LabReportService } from './lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { TemplateRenderService } from '../pdf-report-template/services/template-render.service';
import { LatteReportRenderService } from '../pdf-report-template/services/latte-render.service';
import { renderLatte } from '../pdf-report-template/services/latte-renderer.util';

/**
 * Lab All Report: each test's `body_html` is rendered from that test's OWN
 * single-report `lab_report` template (`buildReportBodyHtml`), then dropped into
 * the all-reports template. The per-parameter Overall Result must reach the page
 * for a Latte body, a flat body, and the built-in fallback — and survive being
 * embedded in the outer all-reports document.
 *
 * Uses the real template services (only the DB lookup is stubbed), so this
 * exercises the same engines a print does.
 */
const OVERALL = '<p><strong>Diabetic</strong></p>';

const CONTEXT = {
  variables: { test_name: 'HbA1c' },
  sections: {
    results: [
      {
        parameter_name: 'HbA1c',
        observed1: '7.2',
        unit: '%',
        methodology: 'HPLC',
        reference_display: '4-5.6',
        group_name: '',
        result_note: '',
        overall_result: OVERALL,
      },
      {
        parameter_name: 'eAG',
        observed1: '160',
        unit: 'mg/dL',
        methodology: '',
        reference_display: '',
        group_name: '',
        result_note: '',
        overall_result: '',
      },
    ],
  },
};

function build(bodyHtml: string | null) {
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
    priv.buildReportBodyHtml('r1', 't1', 'b1', CONTEXT);
}

// The outer Lab All Report body: one iteration per test, body dropped in as-is.
const OUTER =
  '{foreach $report_tests->tests as $report}' +
  '<section>{$report->body_html|noescape}</section>{/foreach}';
const wrap = (bodyHtml: string): string =>
  renderLatte(OUTER, {
    report_tests: { groups: [], tests: [{ body_html: bodyHtml }] },
  });

describe('Lab All Report prints the per-parameter Overall Result', () => {
  it('Latte single-report template (the screenshot case)', async () => {
    const body = await build(
      '{foreach $tests as $test}{foreach $test->rows as $row}' +
        '<tr>{$row->parameter_name}</tr>' +
        '{if $row->overall_result != ""}<div class="comment-box">{$row->overall_result|noescape}</div>{/if}' +
        '{/foreach}{/foreach}',
    )();
    expect(body).toContain(`<div class="comment-box">${OVERALL}</div>`);
    // only the parameter that has one gets the box
    expect(body.match(/comment-box/g)).toHaveLength(1);
    expect(body.indexOf('HbA1c')).toBeLessThan(body.indexOf('comment-box'));
    expect(body.indexOf('comment-box')).toBeLessThan(body.indexOf('eAG'));
    // and it survives being embedded in the all-reports document
    expect(wrap(body)).toContain(`<div class="comment-box">${OVERALL}</div>`);
  });

  it('flat single-report template', async () => {
    const body = await build(
      '{{#each results}}<tr>{parameter_name}</tr>{overall_result}{{/each}}',
    )();
    expect(body).toContain(OVERALL);
    expect(wrap(body)).toContain(OVERALL);
  });

  it('built-in fallback when the test has no usable template', async () => {
    const body = await build(null)();
    expect(body).toContain(OVERALL);
    expect(wrap(body)).toContain(OVERALL);
  });
});
