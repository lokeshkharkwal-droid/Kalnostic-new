import { effectiveParameterNoteHtml } from './parameter-note.util';

describe('effectiveParameterNoteHtml', () => {
  it("uses the technician's text for this report instead of the default", () => {
    expect(
      effectiveParameterNoteHtml('<p>Hemolysed</p>', 'Fasting sample needed'),
    ).toBe('<p>Hemolysed</p>');
  });

  it('keeps an empty technician text: the note is blank on this report, the default must not come back', () => {
    expect(effectiveParameterNoteHtml('', 'Fasting sample needed')).toBe('');
  });

  it('falls back to the configured note when the report has none of its own', () => {
    expect(effectiveParameterNoteHtml(undefined, 'Fasting sample needed')).toBe(
      'Fasting sample needed',
    );
  });

  it('escapes the configured note: it is plain text, so a tag typed in Master Data must not become markup', () => {
    expect(effectiveParameterNoteHtml(undefined, 'A & B <b>x</b>')).toBe(
      'A &amp; B &lt;b&gt;x&lt;/b&gt;',
    );
  });

  it('keeps the line breaks the configured note was typed with', () => {
    expect(effectiveParameterNoteHtml(undefined, 'line 1\nline 2')).toBe(
      '<span style="white-space:pre-wrap">line 1\nline 2</span>',
    );
  });

  it('is empty when there is no technician text and no configured note', () => {
    expect(effectiveParameterNoteHtml(undefined, null)).toBe('');
    expect(effectiveParameterNoteHtml(undefined, undefined)).toBe('');
    expect(effectiveParameterNoteHtml(undefined, '   \n ')).toBe('');
  });

  it("passes the technician's HTML through untouched (it is rich text, not escaped)", () => {
    const html = '<ul><li>one</li><li><strong>two</strong></li></ul>';
    expect(effectiveParameterNoteHtml(html, 'ignored')).toBe(html);
  });
});
