import { sanitizeRichText } from './sanitize-rich-text.util';

/**
 * Rich-text notes are cleaned before they are stored: everything the Notes editor can produce stays, everything
 * active goes. The "kept" cases are what TinyMCE really writes (toolbar: fonts, sizes, colours, alignment, line height,
 * lists, tables, links, uploaded images); the "removed" cases are what a direct API call could add.
 *
 * The cleaner re-writes the HTML it keeps in a tidy form that means exactly the same: a `style` loses the space after
 * each colon and its trailing semicolon, and an image is written `<img … />`. `keeps(input, tidy)` shows both.
 */
describe('sanitizeRichText — what the editor produces is kept', () => {
  const same = (html: string) => expect(sanitizeRichText(html)).toBe(html);
  const keeps = (input: string, tidy: string) =>
    expect(sanitizeRichText(input)).toBe(tidy);

  it('formatting, headings and lists', () => {
    same(
      '<h2>Heading</h2><p>Fasting <strong>needed</strong>, <em>mild</em> and <u>urgent</u></p>',
    );
    same('<ul><li>one</li><li>two</li></ul><ol start="3"><li>three</li></ol>');
    same(
      '<blockquote>quoted</blockquote><p>H<sub>2</sub>O and x<sup>2</sup></p><hr />',
    );
  });

  it('a toolbar-formatted paragraph (font, size, colours, alignment, line height, indent)', () => {
    keeps(
      '<p style="font-family: arial, helvetica, sans-serif; font-size: 14pt; color: #e03e2d; background-color: #fbeeb8; text-align: center; line-height: 1.5; padding-left: 40px;">text</p>',
      '<p style="font-family:arial, helvetica, sans-serif;font-size:14pt;color:#e03e2d;background-color:#fbeeb8;text-align:center;line-height:1.5;padding-left:40px">text</p>',
    );
    keeps(
      '<span style="color: rgb(224, 62, 45); font-weight: bold;">red</span>',
      '<span style="color:rgb(224, 62, 45);font-weight:bold">red</span>',
    );
  });

  it('a table with widths, borders and merged cells', () => {
    keeps(
      '<table style="border-collapse: collapse; width: 100%;"><thead><tr><th style="width: 50%;">A</th><th>B</th></tr></thead><tbody><tr><td colspan="2" style="border: 1px solid #000;">x</td></tr></tbody></table>',
      '<table style="border-collapse:collapse;width:100%"><thead><tr><th style="width:50%">A</th><th>B</th></tr></thead><tbody><tr><td colspan="2" style="border:1px solid #000">x</td></tr></tbody></table>',
    );
  });

  it('links (http, https, mailto, tel) with a target, and an uploaded image with its size', () => {
    same(
      '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener">link</a>',
    );
    same(
      '<a href="mailto:lab@example.com">mail</a><a href="tel:+911234567890">call</a>',
    );
    keeps(
      '<img src="https://cdn.example.com/folder/pic.png" alt="chart" width="300" height="200">',
      '<img src="https://cdn.example.com/folder/pic.png" alt="chart" width="300" height="200" />',
    );
  });

  it('an older note with a data: image and a relative image address', () => {
    keeps(
      '<img src="data:image/png;base64,iVBORw0KGgo=">',
      '<img src="data:image/png;base64,iVBORw0KGgo=" />',
    );
    keeps('<img src="/uploads/pic.png">', '<img src="/uploads/pic.png" />');
  });

  it('plain text, text with entities, and an empty string come back unchanged', () => {
    expect(sanitizeRichText('Fasting sample')).toBe('Fasting sample');
    expect(sanitizeRichText('5 &lt; 6 &amp; 7 &gt; 2')).toBe(
      '5 &lt; 6 &amp; 7 &gt; 2',
    );
    expect(sanitizeRichText('')).toBe('');
  });
});

describe('sanitizeRichText — what is active is removed', () => {
  it('a script tag goes, with its content; the rest of the note stays', () => {
    expect(
      sanitizeRichText(
        '<p>Hello</p><script>fetch("http://internal-server/secret")</script>',
      ),
    ).toBe('<p>Hello</p>');
  });

  it('an event-handler attribute goes, the tag stays', () => {
    expect(sanitizeRichText('<img src="x" onerror="alert(1)">')).toBe(
      '<img src="x" />',
    );
    expect(sanitizeRichText('<p onclick="steal()" class="a">hi</p>')).toBe(
      '<p class="a">hi</p>',
    );
  });

  it('a javascript: link loses its target, whatever the case or spacing', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe(
      '<a>click</a>',
    );
    expect(sanitizeRichText('<a href="JaVaScRiPt:alert(1)">click</a>')).toBe(
      '<a>click</a>',
    );
    expect(sanitizeRichText('<a href=" \tjavascript:alert(1)">click</a>')).toBe(
      '<a>click</a>',
    );
  });

  it('a data: or vbscript: link is not allowed', () => {
    expect(
      sanitizeRichText(
        '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      ),
    ).toBe('<a>x</a>');
    expect(sanitizeRichText('<a href="vbscript:msgbox(1)">x</a>')).toBe(
      '<a>x</a>',
    );
  });

  it('iframes, objects, embeds, forms and svg are dropped', () => {
    expect(
      sanitizeRichText('<iframe src="http://internal-server/admin"></iframe>'),
    ).toBe('');
    expect(sanitizeRichText('<object data="x"></object><embed src="x">')).toBe(
      '',
    );
    expect(
      sanitizeRichText(
        '<form action="http://evil"><input name="a"><button>go</button></form>',
      ),
    ).not.toMatch(/<(form|input|button)/);
    expect(
      sanitizeRichText(
        '<svg onload="alert(1)"><script>alert(1)</script></svg>',
      ),
    ).not.toMatch(/<svg|<script|onload/);
  });

  it('a style block, a link/meta tag and a base tag are dropped', () => {
    expect(
      sanitizeRichText('<style>body{display:none}</style><p>text</p>'),
    ).toBe('<p>text</p>');
    expect(
      sanitizeRichText(
        '<link rel="stylesheet" href="http://evil/x.css"><meta http-equiv="refresh" content="0;url=http://evil"><base href="http://evil/"><p>t</p>',
      ),
    ).toBe('<p>t</p>');
  });

  it('a style attribute keeps plain presentation and loses anything that loads a URL or computes', () => {
    expect(
      sanitizeRichText(
        '<p style="color: red; background-image: url(http://internal-server/x.png)">a</p>',
      ),
    ).toBe('<p style="color:red">a</p>');
    expect(
      sanitizeRichText('<p style="background-color: url(http://x/y)">a</p>'),
    ).toBe('<p>a</p>');
    expect(
      sanitizeRichText('<p style="width: expression(alert(1))">a</p>'),
    ).toBe('<p>a</p>');
    expect(
      sanitizeRichText(
        '<p style="position: fixed; top: 0; left: 0; width: 100%; height: 100%">a</p>',
      ),
    ).toBe('<p style="width:100%;height:100%">a</p>');
  });

  it('a protocol-relative address is not allowed', () => {
    expect(sanitizeRichText('<a href="//evil.example/x">x</a>')).toBe(
      '<a>x</a>',
    );
  });

  it('broken or nested markup cannot smuggle a script through', () => {
    expect(
      sanitizeRichText('<scr<script>ipt>alert(1)</scr</script>ipt>'),
    ).not.toMatch(/<script/i);
    expect(
      sanitizeRichText('<<script>script>alert(1)<</script>/script>'),
    ).not.toMatch(/<script/i);
    expect(sanitizeRichText('<img src=x onerror=alert(1)//')).not.toMatch(
      /onerror/i,
    );
    expect(sanitizeRichText('<div><p>unclosed <strong>bold')).toBe(
      '<div><p>unclosed <strong>bold</strong></p></div>',
    );
  });
});

describe('sanitizeRichText — behaviour worth knowing', () => {
  it('a very long note is cleaned without trouble', () => {
    const big = '<p>' + 'x'.repeat(900_000) + '</p>';
    const t0 = Date.now();
    expect(sanitizeRichText(big)).toBe(big);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('running it twice changes nothing more (cleaning is stable)', () => {
    const dirty =
      '<p style="color:red;background-image:url(x)" onclick="x()">a<script>b</script></p>';
    const once = sanitizeRichText(dirty);
    expect(sanitizeRichText(once)).toBe(once);
  });
});
