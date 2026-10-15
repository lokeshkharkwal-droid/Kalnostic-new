import { LabReportService } from './lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { TemplateRenderService } from '../pdf-report-template/services/template-render.service';
import { LatteReportRenderService } from '../pdf-report-template/services/latte-render.service';
import { observedValueHtml } from './utils/print-value.util';

/**
 * A Qualitative result written over several lines prints exactly as typed — line breaks, blank lines, indentation — in every
 * kind of report body: the test's own flat template, a Latte template, and the built-in layout used when a test has no
 * usable template. The rows are built the way `buildPrintContext` builds them (`observed1` is the safe HTML of
 * `observedValueHtml`), so these specs follow the real data shape, not a raw string.
 * Uses the real template services (only the DB lookup is stubbed), like the other all-report specs.
 */
const TYPED =
  'I am a boy from India.\n\nI love doing software testing.\n    - indented line';
const TYPED_HTML = observedValueHtml(TYPED);

const row = (observed1Raw: string, extra: Record<string, unknown> = {}) => ({
  parameter_name: 'Qualitative Test One',
  observed1: observedValueHtml(observed1Raw),
  observed2: '',
  observed1_raw: observed1Raw,
  observed2_raw: '',
  is_observed_1_abnormal: false,
  is_observed_2_abnormal: false,
  unit: '',
  methodology: 'CLIA',
  reference_display: 'Qualitative Value',
  group_name: '',
  result_note: '',
  overall_result: '',
  ...extra,
});

function build(bodyHtml: string | null, rows: unknown[]) {
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
  const context = {
    variables: { test_name: 'Qualitative Test Print' },
    sections: { results: rows },
  };
  return (): Promise<string> =>
    priv.buildReportBodyHtml('r1', 't1', 'b1', context);
}

describe('a multi-line Qualitative result prints exactly as typed', () => {
  it('flat template: the typed text reaches the page untouched, inside the pre-wrap block', async () => {
    const body = await build('{{#each results}}<td>{observed1}</td>{{/each}}', [
      row(TYPED),
    ])();
    expect(body).toContain(`<td>${TYPED_HTML}</td>`);
    expect(body).toContain('white-space:pre-wrap');
    expect(body).toContain(
      'I am a boy from India.\n\nI love doing software testing.\n    - indented line',
    );
  });

  it('flat template: {observed1} {observed2} side by side (the shipped default layout)', async () => {
    const body = await build(
      '{{#each results}}<span>{observed1} {observed2}</span>{{/each}}',
      [row(TYPED)],
    )();
    expect(body).toContain(`<span>${TYPED_HTML} </span>`);
  });

  it('Latte template: {$row->observed1|noescape} keeps it too', async () => {
    const body = await build(
      '{foreach $tests as $test}{foreach $test->rows as $row}<td>{$row->observed1|noescape}</td>{/foreach}{/foreach}',
      [row(TYPED)],
    )();
    expect(body).toContain(`<td>${TYPED_HTML}</td>`);
  });

  it('built-in layout (no usable template): printed as-is, not escaped a second time', async () => {
    const body = await build(null, [row(TYPED)])();
    expect(body).toContain(`<td>${TYPED_HTML}</td>`);
    expect(body).not.toContain('&lt;span');
    expect(body).not.toContain('&amp;');
  });

  it('built-in layout: a value with & and < prints once-escaped, not twice', async () => {
    const body = await build(null, [row('a & b <c>\nsecond')])();
    expect(body).toContain('a &amp; b &lt;c&gt;\nsecond');
    expect(body).not.toContain('&amp;amp;');
  });

  it('a one-line value is unchanged in every layout', async () => {
    for (const template of [
      '{{#each results}}<td>{observed1}</td>{{/each}}',
      null,
    ]) {
      const body = await build(template, [row('Positive')])();
      expect(body).toContain('<td>Positive</td>');
      expect(body).not.toContain('pre-wrap');
    }
  });

  it('an out-of-range quantitative value keeps its abnormal styling next to a multi-line one', async () => {
    const abnormal = row('180', {
      parameter_name: 'Glucose',
      observed1: '<span style="font-weight:bold;color:#d32f2f">180</span>',
      is_observed_1_abnormal: true,
    });
    const body = await build('{{#each results}}<td>{observed1}</td>{{/each}}', [
      abnormal,
      row(TYPED),
    ])();
    expect(body).toContain(
      '<td><span style="font-weight:bold;color:#d32f2f">180</span></td>',
    );
    expect(body).toContain(`<td>${TYPED_HTML}</td>`);
  });
});
