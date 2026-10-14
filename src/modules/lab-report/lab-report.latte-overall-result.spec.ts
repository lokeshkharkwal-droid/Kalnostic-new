import { LabReportService } from './lab-report.service';
import { renderLatte } from '../pdf-report-template/services/latte-renderer.util';

/**
 * A Latte `lab_report` / `lab_all_report` template reads each result row from the
 * object-shaped context `buildTestLatteContext` builds. The per-report Overall
 * Result (`{$row->overall_result}`) must be carried onto every row, or the tag
 * always prints empty even when the technician saved one.
 */
type LatteCtx = { tests: Array<{ rows: Array<Record<string, unknown>> }> };

function build() {
  const deps = Array(11).fill(undefined) as unknown[];
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  return (results: Array<Record<string, unknown>>): LatteCtx =>
    (
      service as unknown as {
        buildTestLatteContext(c: unknown): LatteCtx;
      }
    ).buildTestLatteContext({ variables: {}, sections: { results } });
}

// Same shape as the report body block authors use for a per-parameter comment.
const TEMPLATE =
  '{foreach $tests as $test}{foreach $test->rows as $row}' +
  '<b>{$row->parameter_name}</b>' +
  '{if $row->overall_result != ""}[{$row->overall_result|noescape}]{/if}' +
  '{/foreach}{/foreach}';

describe('Latte result rows carry overall_result', () => {
  it('copies overall_result onto the row', () => {
    const ctx = build()([
      { parameter_name: 'HbA1c', overall_result: '<p>Diabetic</p>' },
    ]);
    expect(ctx.tests[0]?.rows[0]?.overall_result).toBe('<p>Diabetic</p>');
  });

  it('prints the overall result, unescaped, when the template uses the tag', () => {
    const ctx = build()([
      { parameter_name: 'HbA1c', overall_result: '<p>Diabetic</p>' },
    ]);
    expect(renderLatte(TEMPLATE, ctx)).toBe('<b>HbA1c</b>[<p>Diabetic</p>]');
  });

  it('prints nothing extra for a parameter with no overall result', () => {
    const ctx = build()([
      { parameter_name: 'HbA1c', overall_result: '' },
      { parameter_name: 'FBS' },
    ]);
    expect(ctx.tests[0]?.rows.map((r) => r.overall_result)).toEqual(['', '']);
    expect(renderLatte(TEMPLATE, ctx)).toBe('<b>HbA1c</b><b>FBS</b>');
  });

  it('keeps each row’s own overall result', () => {
    const ctx = build()([
      { parameter_name: 'A', overall_result: 'one' },
      { parameter_name: 'B', overall_result: '' },
      { parameter_name: 'C', overall_result: 'three' },
    ]);
    expect(renderLatte(TEMPLATE, ctx)).toBe(
      '<b>A</b>[one]<b>B</b><b>C</b>[three]',
    );
  });
});
