import { TemplateRenderService } from './template-render.service';
import { escapeHtmlKeepLines } from './pdf-document.util';
import {
  PDF_TEMPLATE_META_DEFAULTS,
  PdfTemplateMeta,
} from '../constants/pdf-template-meta.constant';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

/**
 * A reference range's "Display of Reference Range" is typed over several lines in Master Data (one value per line).
 * HTML squashes line breaks, so it used to print as one line ("a b c f"). It must keep its lines when printed.
 */
const meta = (overrides: Partial<PdfTemplateMeta>): PdfTemplateMeta => ({
  ...PDF_TEMPLATE_META_DEFAULTS,
  ...overrides,
});

const results = (reference_display: string): GeneratePdfDto => ({
  sections: {
    results: [{ parameter_name: 'pH', observed1: '6.5', reference_display }],
  },
});

const PRE = (inner: string) =>
  `<span style="white-space:pre-wrap">${inner}</span>`;

describe('escapeHtmlKeepLines', () => {
  it('a value with no line break is only escaped, exactly as before', () => {
    expect(escapeHtmlKeepLines('13 - 17')).toBe('13 - 17');
    expect(escapeHtmlKeepLines('<5 & >2')).toBe('&lt;5 &amp; &gt;2');
    expect(escapeHtmlKeepLines('')).toBe('');
  });

  it('a value typed over several lines keeps every line', () => {
    expect(escapeHtmlKeepLines('a\nb\nc\nf')).toBe(PRE('a\nb\nc\nf'));
  });

  it('keeps a blank line in the middle and the indentation, drops blank lines at the start and the end', () => {
    expect(escapeHtmlKeepLines('\n\n  Adult\n\n    M: 13 - 17\n   \n')).toBe(
      PRE('  Adult\n\n    M: 13 - 17'),
    );
  });

  it('writes Windows and old-Mac line breaks as plain line breaks', () => {
    expect(escapeHtmlKeepLines('a\r\nb\rc')).toBe(PRE('a\nb\nc'));
  });

  it('escapes the text inside the lines', () => {
    expect(escapeHtmlKeepLines('<b>x</b>\n& y')).toBe(
      PRE('&lt;b&gt;x&lt;/b&gt;\n&amp; y'),
    );
  });

  it('only blank lines around one line of text: that one line, only escaped', () => {
    expect(escapeHtmlKeepLines('\n 13 - 17 \n\n')).toBe(' 13 - 17 ');
  });
});

describe('TemplateRenderService — {reference_display} keeps the lines typed in Master Data', () => {
  const service = new TemplateRenderService();
  const body = (cell: string) =>
    meta({
      body_html: `<table>{{#each results}}<tr><td>${cell}</td></tr>{{/each}}</table>`,
    });

  it.each([['{reference_display}'], ['{{this.reference_display}}']])(
    'a range typed over several lines prints one line under another (%s)',
    (cell) => {
      const { bodyHtml } = service.render(body(cell), results('a\nb\nc\nf'));
      expect(bodyHtml).toContain(`<td>${PRE('a\nb\nc\nf')}</td>`);
    },
  );

  it('a one-line range prints exactly as before', () => {
    const { bodyHtml } = service.render(
      body('{reference_display}'),
      results('13 - 17'),
    );
    expect(bodyHtml).toContain('<td>13 - 17</td>');
    expect(bodyHtml).not.toContain('pre-wrap');
  });

  it('the tag is matched whatever its letter case', () => {
    const { bodyHtml } = service.render(
      body('{REFERENCE_DISPLAY}'),
      results('a\nb'),
    );
    expect(bodyHtml).toContain(`<td>${PRE('a\nb')}</td>`);
  });

  it('text from the range is escaped, not printed as HTML', () => {
    const { bodyHtml } = service.render(
      body('{reference_display}'),
      results('<b>x</b>\ny'),
    );
    expect(bodyHtml).toContain(PRE('&lt;b&gt;x&lt;/b&gt;\ny'));
    expect(bodyHtml).not.toContain('<b>x</b>');
  });

  it('other plain-text fields are still only escaped (their line breaks are not touched)', () => {
    const { bodyHtml } = service.render(
      meta({
        body_html:
          '<table>{{#each results}}<tr><td>{parameter_name}</td></tr>{{/each}}</table>',
      }),
      {
        sections: {
          results: [{ parameter_name: 'x\ny', reference_display: '' }],
        },
      },
    );
    expect(bodyHtml).toContain('<td>x\ny</td>');
    expect(bodyHtml).not.toContain('pre-wrap');
  });
});
