import { TemplateRenderService } from './template-render.service';
import {
  PDF_TEMPLATE_META_DEFAULTS,
  PdfTemplateMeta,
} from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

/**
 * The parameter-note line of a lab report template: under each result row a line shows that parameter's note,
 * and the whole line disappears when the parameter has no note to show.
 *   {{#if result_note}}<tr class="result-note-row"><td ...>{result_note}</td></tr>{{/if}}
 */
const service = new TemplateRenderService();

const ROW = [
  '{{#each results}}',
  '<tr class="data-row"><td>{parameter_name}</td><td>{observed1}</td></tr>',
  '{{#if result_note}}',
  '<tr class="result-note-row"><td colspan="4">{result_note}</td></tr>',
  '{{/if}}',
  '{{/each}}',
].join('\n');

function render(rows: Array<Record<string, string>>): string {
  const meta: PdfTemplateMeta = {
    ...PDF_TEMPLATE_META_DEFAULTS,
    body_html: ROW,
  };
  const context: GeneratePdfDto = {
    variables: {},
    sections: { results: rows },
  };
  return service.renderBodyFragment(meta, context);
}
const noteRows = (html: string) =>
  (html.match(/class="result-note-row"/g) ?? []).length;

describe('result-note row in a lab report template', () => {
  it('shows the note line under a parameter that has a note, with the note as formatted text', () => {
    const html = render([
      {
        parameter_name: 'Bilirubin',
        observed1: '1.0',
        result_note: '<p><strong>Hemolysed</strong></p>',
      },
    ]);
    expect(noteRows(html)).toBe(1);
    expect(html).toContain('<p><strong>Hemolysed</strong></p>');
  });

  it('adds no line at all for a parameter with an empty note', () => {
    const html = render([
      { parameter_name: 'SGOT', observed1: '40', result_note: '' },
    ]);
    expect(noteRows(html)).toBe(0);
    expect(html).toContain('SGOT');
  });

  it.each([
    ['spaces only', '   '],
    ['an empty paragraph', '<p></p>'],
    ['a paragraph holding only a line break', '<p><br></p>'],
    ['a paragraph holding only a non-breaking space', '<p>&nbsp;</p>'],
    ['several empty paragraphs', '<p></p><p>&nbsp;</p>'],
  ])('adds no line when the note looks empty (%s)', (_n, note) => {
    expect(
      noteRows(
        render([
          { parameter_name: 'SGOT', observed1: '40', result_note: note },
        ]),
      ),
    ).toBe(0);
  });

  it('decides per row: only the rows with a note get a line, and each note stays under its own parameter', () => {
    const html = render([
      { parameter_name: 'A', observed1: '1', result_note: '<p>note-for-A</p>' },
      { parameter_name: 'B', observed1: '2', result_note: '' },
      { parameter_name: 'C', observed1: '3', result_note: '<p>note-for-C</p>' },
    ]);
    expect(noteRows(html)).toBe(2);
    const a = html.indexOf('note-for-A');
    const b = html.indexOf('>B<');
    const c = html.indexOf('note-for-C');
    expect(a).toBeGreaterThan(html.indexOf('>A<'));
    expect(a).toBeLessThan(b);
    expect(c).toBeGreaterThan(b);
  });

  it('a note that is only plain text from Master Data (already escaped by the print) shows as that text', () => {
    const html = render([
      {
        parameter_name: 'A',
        observed1: '1',
        result_note: 'Fasting &lt;sample&gt; needed',
      },
    ]);
    expect(noteRows(html)).toBe(1);
    expect(html).toContain('Fasting &lt;sample&gt; needed');
  });

  it('no rows at all prints no note line and does not fail', () => {
    expect(noteRows(render([]))).toBe(0);
  });
});
