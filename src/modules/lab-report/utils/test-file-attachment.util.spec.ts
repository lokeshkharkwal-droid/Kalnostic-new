import { APPEND_MARKER_CLASS } from '../../pdf/pdf-append.util';
import {
  TestFileAttachment,
  buildTestFileAttachmentAppendHtml,
  buildTestFileAttachmentHtml,
} from './test-file-attachment.util';

function attachment(
  overrides: Partial<TestFileAttachment>,
): TestFileAttachment {
  return {
    kind: 'file',
    fileUrl: 'https://cdn.example/dev/t1/2026/09/30/report_ab12cd.pdf',
    fileName: 'report.pdf',
    uploadedAt: new Date('2026-09-30T10:00:00Z'),
    ...overrides,
  };
}

describe('buildTestFileAttachmentHtml', () => {
  it('renders a File+ PDF as an application/pdf <embed>', () => {
    const html = buildTestFileAttachmentHtml([attachment({})]);
    expect(html).toBe(
      '<div class="test-file-attachment"><embed src="https://cdn.example/dev/t1/2026/09/30/report_ab12cd.pdf" type="application/pdf" title="report.pdf" style="display:block;width:100%;height:120mm;border:0;" /></div>',
    );
  });

  it('returns an empty string when the test has no File+ PDF', () => {
    expect(buildTestFileAttachmentHtml([])).toBe('');
  });

  it('ignores the Image+ and Doc+ buckets, even for PDFs', () => {
    const html = buildTestFileAttachmentHtml([
      attachment({ kind: 'image', fileName: 'scan.pdf' }),
      attachment({ kind: 'document', fileName: 'doc.pdf' }),
    ]);
    expect(html).toBe('');
  });

  it('skips unsupported File+ uploads (sheets, docs) but renders images as <img>', () => {
    const html = buildTestFileAttachmentHtml([
      attachment({ fileName: 'data.xlsx', fileUrl: 'https://cdn/x.xlsx' }),
      attachment({ fileName: 'photo.png', fileUrl: 'https://cdn/p.png' }),
    ]);
    // The spreadsheet is dropped; the image is drawn inline as an <img>.
    expect(html).not.toContain('x.xlsx');
    expect(html).toContain('<img src="https://cdn/p.png"');
  });

  it('detects a PDF by URL path when the file name has no extension', () => {
    const html = buildTestFileAttachmentHtml([
      attachment({ fileName: 'Lab result', fileUrl: 'https://cdn/r.PDF?v=1' }),
    ]);
    expect(html).toContain('src="https://cdn/r.PDF?v=1"');
  });

  it('orders several PDFs oldest-first', () => {
    const html = buildTestFileAttachmentHtml([
      attachment({
        fileName: 'second.pdf',
        uploadedAt: new Date('2026-09-30T12:00:00Z'),
      }),
      attachment({
        fileName: 'first.pdf',
        uploadedAt: new Date('2026-09-30T08:00:00Z'),
      }),
    ]);
    expect(html.indexOf('first.pdf')).toBeLessThan(html.indexOf('second.pdf'));
  });

  it('attribute-escapes the URL and file name', () => {
    const html = buildTestFileAttachmentHtml([
      attachment({
        fileName: 'a"><script>x</script>.pdf',
        fileUrl: 'https://cdn/a.pdf?x=1&y="2"',
      }),
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('src="https://cdn/a.pdf?x=1&amp;y=&quot;2&quot;"');
  });
});

describe('buildTestFileAttachmentAppendHtml', () => {
  it('renders a File+ PDF as a hidden append marker (no <embed>/<img>)', () => {
    const html = buildTestFileAttachmentAppendHtml([attachment({})]);
    expect(html).toBe(
      `<div class="${APPEND_MARKER_CLASS}" data-pdf-append-src="https://cdn.example/dev/t1/2026/09/30/report_ab12cd.pdf" data-pdf-append-name="report.pdf" style="display:none"></div>`,
    );
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('<img');
  });

  it('renders a File+ image as an append marker too (appended, not drawn inline)', () => {
    const html = buildTestFileAttachmentAppendHtml([
      attachment({ fileName: 'smear.png', fileUrl: 'https://cdn/s.png' }),
    ]);
    expect(html).toContain(`class="${APPEND_MARKER_CLASS}"`);
    expect(html).toContain('data-pdf-append-src="https://cdn/s.png"');
    expect(html).not.toContain('<img');
  });

  it('returns an empty string when the test has no File+ PDF/image', () => {
    expect(buildTestFileAttachmentAppendHtml([])).toBe('');
  });

  it('ignores the Image+ and Doc+ buckets', () => {
    const html = buildTestFileAttachmentAppendHtml([
      attachment({ kind: 'image', fileName: 'scan.pdf' }),
      attachment({ kind: 'document', fileName: 'doc.pdf' }),
    ]);
    expect(html).toBe('');
  });

  it('skips non-PDF/non-image File+ uploads (sheets, docs)', () => {
    const html = buildTestFileAttachmentAppendHtml([
      attachment({ fileName: 'data.xlsx', fileUrl: 'https://cdn/x.xlsx' }),
      attachment({ fileName: 'notes.docx', fileUrl: 'https://cdn/n.docx' }),
    ]);
    expect(html).toBe('');
  });

  it('orders several files oldest-first', () => {
    const html = buildTestFileAttachmentAppendHtml([
      attachment({
        fileName: 'second.pdf',
        fileUrl: 'https://cdn/second.pdf',
        uploadedAt: new Date('2026-09-30T12:00:00Z'),
      }),
      attachment({
        fileName: 'first.pdf',
        fileUrl: 'https://cdn/first.pdf',
        uploadedAt: new Date('2026-09-30T08:00:00Z'),
      }),
    ]);
    expect(html.indexOf('first.pdf')).toBeLessThan(html.indexOf('second.pdf'));
  });

  it('attribute-escapes the URL and file name', () => {
    const html = buildTestFileAttachmentAppendHtml([
      attachment({
        fileName: 'a"><script>x</script>.pdf',
        fileUrl: 'https://cdn/a.pdf?x=1&y="2"',
      }),
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain(
      'data-pdf-append-src="https://cdn/a.pdf?x=1&amp;y=&quot;2&quot;"',
    );
  });
});
