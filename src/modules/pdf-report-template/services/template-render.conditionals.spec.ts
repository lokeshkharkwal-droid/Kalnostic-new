import { TemplateRenderService } from './template-render.service';
import {
  PDF_TEMPLATE_META_DEFAULTS,
  PdfTemplateMeta,
} from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

/**
 * `{{#if key}}…{{/if}}` in the flat template engine: a block (heading included)
 * that disappears when its variable shows nothing. This is how a Notes section
 * the technician left out of a report's print loses its heading as well.
 */
const service = new TemplateRenderService();

const body = (
  html: string,
  variables: Record<string, unknown>,
): { html: string } => {
  const meta: PdfTemplateMeta = {
    ...PDF_TEMPLATE_META_DEFAULTS,
    body_html: html,
  };
  const context: GeneratePdfDto = { variables: variables as never };
  return { html: service.renderBodyFragment(meta, context) };
};

const NOTE = '{{#if useful_for}}<h4>USEFUL FOR</h4><p>{useful_for}</p>{{/if}}';

describe('flat template {{#if key}} blocks', () => {
  it('keeps the block (and fills the tag) when the value has text', () => {
    expect(body(NOTE, { useful_for: '<p>Fasting sample</p>' }).html).toBe(
      '<h4>USEFUL FOR</h4><p><p>Fasting sample</p></p>',
    );
  });

  it('drops the whole block, heading included, when the value is empty', () => {
    expect(body(`A${NOTE}B`, { useful_for: '' }).html).toBe('AB');
  });

  it('drops it when the variable is missing, null, or only blank HTML', () => {
    expect(body(`A${NOTE}B`, {}).html).toBe('AB');
    expect(body(`A${NOTE}B`, { useful_for: null }).html).toBe('AB');
    expect(body(`A${NOTE}B`, { useful_for: '<p>&nbsp;</p> ' }).html).toBe('AB');
  });

  it('an image alone counts as content', () => {
    expect(
      body('{{#if pic}}[shown]{{/if}}', { pic: '<img src="x.png">' }).html,
    ).toBe('[shown]');
  });

  it('works for several blocks independently', () => {
    const html = `${NOTE}{{#if remarks}}<h4>REMARKS</h4>{remarks}{{/if}}`;
    expect(
      body(html, { useful_for: '', remarks: 'Repeat in 3 months' }).html,
    ).toBe('<h4>REMARKS</h4>Repeat in 3 months');
  });

  it('supports nesting', () => {
    const html = '{{#if a}}A{{#if b}}B{{/if}}C{{/if}}D';
    expect(body(html, { a: 'x', b: 'y' }).html).toBe('ABCD');
    expect(body(html, { a: 'x', b: '' }).html).toBe('ACD');
    expect(body(html, { a: '', b: 'y' }).html).toBe('D');
  });

  it('leaves a block that is never closed untouched, so the mistake shows', () => {
    expect(body('{{#if a}}oops', { a: 'x' }).html).toBe('{{#if a}}oops');
  });

  it('a template with no {{#if}} renders exactly as before', () => {
    expect(body('<b>{useful_for}</b>', { useful_for: 'x' }).html).toBe(
      '<b>x</b>',
    );
  });
});

/**
 * Inside `{{#each}}` an `{{#if}}` is decided PER ROW (this is how an all-reports
 * template treats a panel test differently from a single test).
 */
describe('flat template {{#if key}} inside {{#each}}', () => {
  const rows = (
    html: string,
    reports: Array<Record<string, unknown>>,
    variables: Record<string, unknown> = {},
  ): string => {
    const meta: PdfTemplateMeta = {
      ...PDF_TEMPLATE_META_DEFAULTS,
      body_html: html,
    };
    const context = {
      variables: variables as never,
      sections: { reports } as never,
    } as GeneratePdfDto;
    return service.renderBodyFragment(meta, context);
  };
  const EACH =
    '{{#each reports}}[{name}{{#if is_lab_panel}} panel:{lab_panel_name}/{lab_panel_code}{{/if}}]{{/each}}';

  it('each row keeps or drops the block on its own fields', () => {
    expect(
      rows(EACH, [
        {
          name: 'T4',
          is_lab_panel: 'Yes',
          lab_panel_name: 'Thyroid',
          lab_panel_code: 'THY',
        },
        {
          name: 'Urine',
          is_lab_panel: '',
          lab_panel_name: '',
          lab_panel_code: '',
        },
        {
          name: 'TSH',
          is_lab_panel: 'Yes',
          lab_panel_name: 'Thyroid',
          lab_panel_code: 'THY',
        },
      ]),
    ).toBe('[T4 panel:Thyroid/THY][Urine][TSH panel:Thyroid/THY]');
  });

  it('a row without the key falls back to the top-level variable', () => {
    expect(
      rows(
        '{{#each reports}}[{name}{{#if flag}}!{{/if}}]{{/each}}',
        [{ name: 'A' }],
        {
          flag: 'x',
        },
      ),
    ).toBe('[A!]');
  });

  it("the row's own empty value wins over a true top-level one", () => {
    expect(
      rows(EACH, [{ name: 'A', is_lab_panel: '' }], { is_lab_panel: 'Yes' }),
    ).toBe('[A]');
  });

  it('a block wrapped around a whole {{#each}} still decides on the top-level variables', () => {
    const html = '{{#if show}}<{{#each reports}}{name}{{/each}}>{{/if}}';
    expect(rows(html, [{ name: 'A' }, { name: 'B' }], { show: 'x' })).toBe(
      '<AB>',
    );
    expect(rows(html, [{ name: 'A' }], { show: '' })).toBe('');
  });

  it('a top-level block and the same key inside the rows do not disturb each other', () => {
    const html =
      '{{#if a}}top{{/if}}{{#each reports}}{{#if a}}[row {name}]{{/if}}{{/each}}';
    expect(
      rows(
        html,
        [
          { name: 'A', a: '' },
          { name: 'B', a: 'y' },
        ],
        { a: 'x' },
      ),
    ).toBe('top[row B]');
  });

  it('text inside a row value is never read as a template tag', () => {
    expect(
      rows('{{#each reports}}[{name}]{{/each}}', [{ name: '{{#if x}}boom' }]),
    ).toBe('[{{#if x}}boom]');
  });

  it('a template with no {{#if}} inside the rows renders exactly as before', () => {
    expect(
      rows('{{#each reports}}[{name}]{{/each}}', [
        { name: 'A' },
        { name: 'B' },
      ]),
    ).toBe('[A][B]');
  });
});
