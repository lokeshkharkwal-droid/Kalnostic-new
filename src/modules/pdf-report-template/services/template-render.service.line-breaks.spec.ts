import { TemplateRenderService } from './template-render.service';
import { escapeHtmlKeepLineBreaks } from './pdf-document.util';
import {
  PDF_TEMPLATE_META_DEFAULTS,
  PdfTemplateMeta,
} from '../constants/pdf-template-meta.constant';

/**
 * A Qualitative result can be written over several lines. A printed report must keep them: the value is
 * still escaped (it is plain text), but each line break prints as `<br />` — HTML would otherwise run the lines
 * together on one. Only the result value (`observed1`) does this; every other plain-text field is unchanged.
 */
function meta(overrides: Partial<PdfTemplateMeta>): PdfTemplateMeta {
  return { ...PDF_TEMPLATE_META_DEFAULTS, ...overrides };
}

const THREE_LINES =
  'Pus cells 8-10 /hpf\nEpithelial cells 2-3 /hpf\nNo casts seen';
const THREE_LINES_HTML =
  'Pus cells 8-10 /hpf<br />Epithelial cells 2-3 /hpf<br />No casts seen';

describe('escapeHtmlKeepLineBreaks', () => {
  it('turns every kind of line break into <br />', () => {
    expect(escapeHtmlKeepLineBreaks('a\nb')).toBe('a<br />b');
    expect(escapeHtmlKeepLineBreaks('a\r\nb')).toBe('a<br />b');
    expect(escapeHtmlKeepLineBreaks('a\rb')).toBe('a<br />b');
  });

  it('keeps a blank line (two breaks give two <br />)', () => {
    expect(escapeHtmlKeepLineBreaks('a\n\nb')).toBe('a<br /><br />b');
  });

  it('still escapes the text, so a typed tag cannot reach the page', () => {
    expect(escapeHtmlKeepLineBreaks('<b>x</b> & y\n<script>1</script>')).toBe(
      '&lt;b&gt;x&lt;/b&gt; &amp; y<br />&lt;script&gt;1&lt;/script&gt;',
    );
  });

  it('leaves single-line text exactly as escapeHtml does', () => {
    expect(escapeHtmlKeepLineBreaks('Positive')).toBe('Positive');
    expect(escapeHtmlKeepLineBreaks('')).toBe('');
  });
});

describe('TemplateRenderService — a result value keeps its line breaks', () => {
  const service = new TemplateRenderService();
  const ctx = (observed1: string, extra: Record<string, unknown> = {}) => ({
    variables: { test_name: 'Urine R/E' },
    sections: {
      results: [{ parameter_name: 'Microscopy', observed1, ...extra }],
    },
  });

  it('{observed1} in a results row prints the lines separated by <br />', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html: '{{#each results}}<td>{observed1}</td>{{/each}}',
      }),
      ctx(THREE_LINES),
    );
    expect(html).toContain(`<td>${THREE_LINES_HTML}</td>`);
    expect(html).not.toContain('\n'.concat('Epithelial'));
  });

  it('{{this.observed1}} does too', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html: '{{#each results}}<td>{{this.observed1}}</td>{{/each}}',
      }),
      ctx(THREE_LINES),
    );
    expect(html).toContain(`<td>${THREE_LINES_HTML}</td>`);
  });

  it('the value is still escaped', () => {
    const html = service.renderBodyFragment(
      meta({ body_html: '{{#each results}}<td>{observed1}</td>{{/each}}' }),
      ctx('<img src=x onerror=1>\nsecond'),
    );
    expect(html).toContain('<td>&lt;img src=x onerror=1&gt;<br />second</td>');
    expect(html).not.toContain('<img');
  });

  it('a one-line value prints unchanged', () => {
    const html = service.renderBodyFragment(
      meta({ body_html: '{{#each results}}<td>{observed1}</td>{{/each}}' }),
      ctx('Positive'),
    );
    expect(html).toContain('<td>Positive</td>');
    expect(html).not.toContain('<br');
  });

  it('other plain-text fields are unchanged: their line breaks are not turned into <br />', () => {
    const html = service.renderBodyFragment(
      meta({
        body_html:
          '{{#each results}}<td>{parameter_name}</td><td>{result_note}</td>{{/each}}',
      }),
      ctx('x', { parameter_name: 'a\nb', result_note: 'n1\nn2' }),
    );
    expect(html).toContain('<td>a\nb</td><td>n1\nn2</td>');
    expect(html).not.toContain('<br');
  });

  it('works through the full render as well (not only the body fragment)', () => {
    const { bodyHtml } = service.render(
      meta({ body_html: '{{#each results}}<td>{observed1}</td>{{/each}}' }),
      ctx(THREE_LINES),
    );
    expect(bodyHtml).toContain(`<td>${THREE_LINES_HTML}</td>`);
  });
});
