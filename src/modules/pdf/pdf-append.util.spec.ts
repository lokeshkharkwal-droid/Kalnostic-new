import { PDFDocument } from 'pdf-lib';
import {
  AppendPiece,
  appendPiecesToPdf,
  firstPageSizeOf,
  isGif,
  isJpeg,
  isPng,
  isWebp,
} from './pdf-append.util';

/** A report/attachment PDF with `pages` pages of the given size. */
async function makePdf(
  pages: number,
  size: [number, number] = [595, 842],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage(size).drawText(`page ${i + 1}`, { x: 40, y: 40 });
  }
  return doc.save();
}

function pdfPiece(bytes: Uint8Array, name = 'a.pdf'): AppendPiece {
  return { type: 'pdf', name, bytes };
}

describe('image signature detectors', () => {
  it('detect PNG / JPEG / WebP / GIF by magic bytes', () => {
    expect(isPng(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isWebp(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary'))).toBe(
      true,
    );
    expect(isGif(Buffer.from('GIF89a', 'binary'))).toBe(true);
    // cross-checks
    expect(isPng(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(isWebp(Buffer.from('RIFF....AVI ', 'binary'))).toBe(false);
    expect(isJpeg(Buffer.from([]))).toBe(false);
  });
});

describe('firstPageSizeOf', () => {
  it('returns the report first page size', async () => {
    const size = await firstPageSizeOf(await makePdf(2, [400, 600]));
    expect(Math.round(size.width)).toBe(400);
    expect(Math.round(size.height)).toBe(600);
  });
});

describe('appendPiecesToPdf', () => {
  it('returns the report unchanged when there is nothing to append', async () => {
    const report = await makePdf(5);
    const out = await appendPiecesToPdf(report, []);
    expect(out).toBe(report);
  });

  it('merges a PDF piece page-for-page (5 + 3 = 8 pages)', async () => {
    const report = await makePdf(5);
    const out = await appendPiecesToPdf(report, [pdfPiece(await makePdf(3))]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(8);
  });

  it('appends multiple PDF pieces in order, counts adding up', async () => {
    const report = await makePdf(1);
    const out = await appendPiecesToPdf(report, [
      pdfPiece(await makePdf(2), 'first.pdf'),
      pdfPiece(await makePdf(1), 'last.pdf'),
    ]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
  });

  it('draws a visible note page for a note piece (not silent)', async () => {
    const report = await makePdf(3);
    const onNote = jest.fn();
    const out = await appendPiecesToPdf(
      report,
      [
        {
          type: 'note',
          name: 'secret.pdf',
          reason: 'image could not be rendered',
        },
      ],
      onNote,
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
    expect(onNote).toHaveBeenCalledWith(
      'secret.pdf',
      'image could not be rendered',
    );
  });

  it('turns an unreadable/encrypted PDF piece into a note page', async () => {
    const report = await makePdf(2);
    const onNote = jest.fn();
    const out = await appendPiecesToPdf(
      report,
      [pdfPiece(Buffer.from('%PDF-1.7 but not actually valid'), 'broken.pdf')],
      onNote,
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
    expect(onNote).toHaveBeenCalledWith('broken.pdf', 'file could not be read');
  });

  it('keeps good pieces when one piece fails', async () => {
    const report = await makePdf(2);
    const out = await appendPiecesToPdf(report, [
      pdfPiece(Buffer.from('garbage'), 'broken.pdf'), // -> note page (1)
      pdfPiece(await makePdf(3), 'good.pdf'), // -> 3 pages
    ]);
    // 2 report + 1 note + 3 good = 6
    expect((await PDFDocument.load(out)).getPageCount()).toBe(6);
  });

  it('does not embed a font when no note page is needed', async () => {
    const report = await makePdf(1);
    const out = await appendPiecesToPdf(report, [pdfPiece(await makePdf(1))]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
});
