import {
  TestFileAttachment,
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

  it('skips non-PDF File+ uploads (sheets, docs, images)', () => {
    const html = buildTestFileAttachmentHtml([
      attachment({ fileName: 'data.xlsx', fileUrl: 'https://cdn/x.xlsx' }),
      attachment({ fileName: 'photo.png', fileUrl: 'https://cdn/p.png' }),
    ]);
    expect(html).toBe('');
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
