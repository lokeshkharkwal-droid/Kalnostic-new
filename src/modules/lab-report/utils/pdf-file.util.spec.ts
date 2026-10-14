import { isImageFileName, isPdfFileName } from './pdf-file.util';

describe('isPdfFileName', () => {
  it('matches a .pdf file name', () => {
    expect(isPdfFileName('report.pdf', 'https://cdn.example.com/x/y')).toBe(
      true,
    );
  });

  it('matches case-insensitively', () => {
    expect(isPdfFileName('REPORT.PDF', '')).toBe(true);
  });

  it('matches when only the URL path ends in .pdf (query/hash ignored)', () => {
    expect(
      isPdfFileName(
        'report',
        'https://cdn.example.com/x/report.pdf?sig=abc#p1',
      ),
    ).toBe(true);
  });

  it('rejects a non-PDF name and URL', () => {
    expect(isPdfFileName('qc.xlsx', 'https://cdn.example.com/x/qc.xlsx')).toBe(
      false,
    );
  });

  it('rejects a name that only contains ".pdf" but does not end with it', () => {
    expect(
      isPdfFileName(
        'report.pdf.xlsx',
        'https://cdn.example.com/x/report.pdf.xlsx',
      ),
    ).toBe(false);
  });

  it('rejects an image', () => {
    expect(
      isPdfFileName('smear.png', 'https://cdn.example.com/x/smear.png'),
    ).toBe(false);
  });
});

describe('isImageFileName', () => {
  it.each(['smear.png', 'smear.JPG', 'smear.jpeg', 'smear.webp', 'smear.gif'])(
    'matches raster image extension %s',
    (name) => {
      expect(isImageFileName(name, '')).toBe(true);
    },
  );

  it('rejects SVG (not a standard raster image)', () => {
    expect(
      isImageFileName('logo.svg', 'https://cdn.example.com/x/logo.svg'),
    ).toBe(false);
  });

  it('matches when only the URL path ends in an image extension (query/hash ignored)', () => {
    expect(
      isImageFileName(
        'smear',
        'https://cdn.example.com/x/smear.png?sig=abc#p1',
      ),
    ).toBe(true);
  });

  it('rejects a PDF', () => {
    expect(
      isImageFileName('report.pdf', 'https://cdn.example.com/x/report.pdf'),
    ).toBe(false);
  });

  it('rejects a non-image document', () => {
    expect(
      isImageFileName('qc.xlsx', 'https://cdn.example.com/x/qc.xlsx'),
    ).toBe(false);
  });
});
