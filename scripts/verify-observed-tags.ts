/**
 * One-off manual check for the abnormal-flag observed tags
 * (`{observed1}` / `{observed2}` styling + `{is_observed_1_abnormal}` /
 * `{is_observed_2_abnormal}`). Renders the REAL seeded `lab_report` sample
 * template body through the REAL `TemplateRenderService`, feeding it rows built
 * with the SAME shared helpers `LabReportService.buildPrintContext` uses
 * (`isObservedAbnormal` + `abnormalFlagStyle` + `escapeHtml`). No DB required.
 *
 * Run: pnpm exec ts-node --transpile-only -r tsconfig-paths/register scripts/verify-observed-tags.ts
 */
import { AbnormalFlag, ResultType } from '@prisma/client';
import { TEMPLATES } from '../prisma/seed-print-templates';
import { TemplateRenderService } from '../src/modules/pdf-report-template/services/template-render.service';
import { PdfTemplateMeta } from '../src/modules/pdf-report-template/constants/pdf-template-meta.constant';
import { escapeHtml } from '../src/modules/pdf-report-template/services/pdf-document.util';
import {
  abnormalFlagStyle,
  isObservedAbnormal,
} from '../src/modules/lab-report/utils/reference-range.util';

type Range = {
  lowerLimit: number;
  upperLimit: number;
  abnormalFlagLogic: AbnormalFlag;
};

/** Mirrors the `classifyObserved` closure inside `buildPrintContext`. */
function classify(
  raw: string,
  resultType: ResultType,
  range: Range | undefined,
): { html: string; abnormal: boolean } {
  const safe = escapeHtml(raw);
  const abnormal = isObservedAbnormal(raw, resultType, range);
  if (!abnormal) return { html: safe, abnormal: false };
  return {
    html: `<span style="${abnormalFlagStyle(range!.abnormalFlagLogic)}">${safe}</span>`,
    abnormal: true,
  };
}

/** Build one `sections.results` row the way `buildPrintContext` would. */
function row(
  name: string,
  resultType: ResultType,
  o1: string,
  o2: string,
  range: Range | undefined,
  refDisplay: string,
) {
  const c1 = classify(o1, resultType, range);
  const c2 = classify(o2, resultType, range);
  return {
    parameter_name: name,
    observed1: c1.html,
    observed2: c2.html,
    is_observed_1_abnormal: c1.abnormal,
    is_observed_2_abnormal: c2.abnormal,
    unit: 'mg/dL',
    methodology: 'Photometry',
    reference_display: refDisplay,
  };
}

function main(): void {
  const tpl = TEMPLATES.find((t) => t.type === 'lab_report');
  if (!tpl) throw new Error('lab_report sample template not found');

  const RED = AbnormalFlag.BOLD_AND_RED;
  const results = [
    // High (above upper) → styled + abnormal; blank Observed 2 → normal.
    row(
      'Glucose',
      ResultType.QUANTITATIVE,
      '145',
      '',
      { lowerLimit: 70, upperLimit: 110, abnormalFlagLogic: RED },
      '70 - 110',
    ),
    // Low (below lower) → styled + abnormal.
    row(
      'Haemoglobin',
      ResultType.QUANTITATIVE,
      '9',
      '',
      {
        lowerLimit: 13,
        upperLimit: 17,
        abnormalFlagLogic: AbnormalFlag.COLOUR_HIGHLIGHT,
      },
      '13 - 17',
    ),
    // In range → plain, not abnormal.
    row(
      'Sodium',
      ResultType.QUANTITATIVE,
      '140',
      '',
      { lowerLimit: 135, upperLimit: 145, abnormalFlagLogic: RED },
      '135 - 145',
    ),
    // Qualitative → never styled, never abnormal (even though "numeric-ish" absent).
    row(
      'Culture',
      ResultType.QUALITATIVE,
      'Positive',
      '',
      undefined,
      'No growth',
    ),
  ];

  const service = new TemplateRenderService();
  const html = service.renderBodyFragment(
    tpl.meta as unknown as PdfTemplateMeta,
    {
      variables: { branch_name: 'Demo Lab', test_name: 'Biochemistry' },
      sections: { results },
    },
  );

  console.log('\n──────── Rendered lab_report body ────────\n');
  console.log(html);
  console.log('\n──────── Assertions ────────\n');

  const checks: Array<[string, boolean]> = [
    [
      'Glucose 145 wrapped in bold-red span',
      html.includes('<span style="font-weight:bold;color:#d32f2f">145</span>'),
    ],
    [
      'Glucose is_observed_1_abnormal = true',
      html.includes('>145</span></td><td>true</td>'),
    ],
    [
      'Haemoglobin 9 wrapped in highlight span',
      html.includes('<span style="background-color:#fff176">9</span>'),
    ],
    [
      'Sodium 140 is plain (no span)',
      html.includes('<td>140</td>') && !html.includes('>140</span>'),
    ],
    [
      'Sodium is_observed_1_abnormal = false',
      html.includes('<td>140</td><td>false</td>'),
    ],
    [
      'Culture Positive is plain (qualitative, not styled)',
      html.includes('<td>Positive</td>'),
    ],
    [
      'Culture is_observed_1_abnormal = false',
      html.includes('<td>Positive</td><td>false</td>'),
    ],
    [
      'Blank Observed 2 is not flagged abnormal',
      html.includes('<td></td><td>false</td>'),
    ],
  ];

  let ok = true;
  for (const [label, passed] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
    if (!passed) ok = false;
  }
  console.log('');
  if (!ok) {
    console.error('Some assertions FAILED.');
    process.exit(1);
  }
  console.log('All assertions passed.');
}

main();
