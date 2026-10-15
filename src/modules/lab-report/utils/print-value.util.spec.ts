import { observedValueHtml } from './print-value.util';

/**
 * A reading prints exactly as the user typed it. HTML squashes line breaks, runs of spaces and tabs into single spaces, so a
 * value that has any of them is shown in a pre-wrap span (a multi-line one as its own left-aligned block). An ordinary
 * one-line value is only escaped, as before.
 */
describe('observedValueHtml', () => {
  const MULTI = 'display:block;white-space:pre-wrap;text-align:left';
  const SPACED = 'white-space:pre-wrap';

  describe('an ordinary value is only escaped (unchanged)', () => {
    it.each([
      ['Positive'],
      ['12.5'],
      ['Not detected'],
      ['a b c'],
      [''],
      ['1,200 / mm3'],
    ])('%j', (raw) => {
      expect(observedValueHtml(raw)).toBe(raw);
    });
    it('escapes markup', () => {
      expect(observedValueHtml('<b>x</b> & y')).toBe(
        '&lt;b&gt;x&lt;/b&gt; &amp; y',
      );
    });
  });

  describe('several lines: one left-aligned block, every character kept', () => {
    it('keeps the line breaks as real line breaks (not <br />)', () => {
      const out = observedValueHtml(
        'I am a boy from India.\nI love doing software testing.',
      );
      expect(out).toBe(
        `<span style="${MULTI}">I am a boy from India.\nI love doing software testing.</span>`,
      );
      expect(out).not.toContain('<br');
    });
    it('keeps blank lines, however many', () => {
      expect(observedValueHtml('a\n\n\nb')).toBe(
        `<span style="${MULTI}">a\n\n\nb</span>`,
      );
    });
    it('keeps indentation and runs of spaces on every line', () => {
      expect(
        observedValueHtml('Findings:\n    - first\n        - nested'),
      ).toBe(
        `<span style="${MULTI}">Findings:\n    - first\n        - nested</span>`,
      );
    });
    it('keeps tabs', () => {
      expect(observedValueHtml('a\tb\n\tc')).toBe(
        `<span style="${MULTI}">a\tb\n\tc</span>`,
      );
    });
    it('keeps leading and trailing blank lines and spaces', () => {
      expect(observedValueHtml('\n  top\nbottom  \n')).toBe(
        `<span style="${MULTI}">\n  top\nbottom  \n</span>`,
      );
    });
    it('turns Windows and old-Mac line endings into one line break each', () => {
      expect(observedValueHtml('a\r\nb\rc')).toBe(
        `<span style="${MULTI}">a\nb\nc</span>`,
      );
    });
    it('still escapes every line (a typed tag cannot reach the page)', () => {
      expect(
        observedValueHtml('<script>1</script>\n<img src=x onerror=1> & more'),
      ).toBe(
        `<span style="${MULTI}">&lt;script&gt;1&lt;/script&gt;\n&lt;img src=x onerror=1&gt; &amp; more</span>`,
      );
    });
    it('keeps a very long text intact', () => {
      const raw = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
      const out = observedValueHtml(raw);
      expect(out.split('\n')).toHaveLength(500);
      expect(out).toContain('line 499');
    });
  });

  describe('one line with spaces or tabs HTML would collapse: kept, still centred', () => {
    it.each([
      ['two  spaces', 'two  spaces'],
      ['  leading', '  leading'],
      ['trailing  ', 'trailing  '],
      [' x ', ' x '],
      ['a\tb', 'a\tb'],
    ])('%j', (raw, shown) => {
      expect(observedValueHtml(raw)).toBe(
        `<span style="${SPACED}">${shown}</span>`,
      );
    });
    it('does not make it a left-aligned block', () => {
      expect(observedValueHtml('two  spaces')).not.toContain('display:block');
      expect(observedValueHtml('two  spaces')).not.toContain('text-align');
    });
  });

  it('a single space between words is not treated as special', () => {
    expect(observedValueHtml('one two')).toBe('one two');
  });
});
