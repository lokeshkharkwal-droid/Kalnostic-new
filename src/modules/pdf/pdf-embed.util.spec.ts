import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  degrees,
} from 'pdf-lib';
import {
  MAX_EMBED_PAGES,
  embedMarkerUrl,
  fileNameFromUrl,
  fitSlotPx,
  isPdfEmbed,
  looksLikePdf,
  newEmbedMarkerPrefix,
  overlayEmbeddedPdfs,
  parseEmbedMarkerUrl,
  readPdfEmbedSource,
} from './pdf-embed.util';

/** A source PDF with `pages` A4 pages (optionally rotated). */
async function sourcePdf(pages: number, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(rotate));
    page.drawText(`source page ${i + 1}`, { x: 50, y: 700 });
  }
  return doc.save();
}

/** A "Chromium output" PDF: one page carrying Link annotations with the given URIs. */
async function printedPdf(
  links: Array<{ uri: string; rect: [number, number, number, number] }>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const refs = links.map(({ uri, rect }) =>
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: rect,
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
      }),
    ),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return doc.save();
}

/** URIs of the Link annotations left on page `index`. */
function linkUris(doc: PDFDocument, index = 0): string[] {
  const annots = doc.getPage(index).node.Annots();
  if (!annots) {
    return [];
  }
  return annots.asArray().map((_, i) => {
    const action = annots.lookup(i, PDFDict).lookup(PDFName.of('A'), PDFDict);
    return action.lookup(PDFName.of('URI'), PDFString).decodeText();
  });
}

/** Names of the XObjects drawn on page `index` (an embedded page is one). */
function xObjectNames(doc: PDFDocument, index = 0): string[] {
  const resources = doc.getPage(index).node.Resources();
  const xObjects = resources?.lookup(PDFName.of('XObject'));
  return xObjects instanceof PDFDict
    ? xObjects.keys().map((k) => k.asString())
    : [];
}

describe('pdf-embed util', () => {
  describe('isPdfEmbed', () => {
    it('is true for an explicit application/pdf type', () => {
      expect(isPdfEmbed('https://cdn/file', 'application/pdf')).toBe(true);
      expect(isPdfEmbed('https://cdn/file', ' Application/PDF ')).toBe(true);
    });

    it('is true for a .pdf path, ignoring query and hash', () => {
      expect(isPdfEmbed('https://cdn/a.PDF?v=2#page=1', '')).toBe(true);
    });

    it('is false for other embeds', () => {
      expect(isPdfEmbed('https://cdn/logo.svg', 'image/svg+xml')).toBe(false);
      expect(isPdfEmbed('https://cdn/a.pdf.png', '')).toBe(false);
    });
  });

  describe('fileNameFromUrl', () => {
    it('returns the decoded last path segment', () => {
      expect(fileNameFromUrl('https://cdn/x/My%20Report.pdf?v=1')).toBe(
        'My Report.pdf',
      );
    });

    it('falls back to the URL when there is no segment', () => {
      expect(fileNameFromUrl('https://cdn/')).toBe('https://cdn/');
    });
  });

  describe('looksLikePdf', () => {
    it('accepts a %PDF- header, also after a little leading junk', () => {
      expect(looksLikePdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
      expect(looksLikePdf(Buffer.from('\n\n%PDF-1.4'))).toBe(true);
    });

    it('rejects anything else', () => {
      expect(looksLikePdf(Buffer.from('<html>not a pdf</html>'))).toBe(false);
    });
  });

  describe('readPdfEmbedSource', () => {
    it('reads each page size', async () => {
      const source = await readPdfEmbedSource(await sourcePdf(2));
      expect(source?.pageSizes).toEqual([
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ]);
    });

    it('swaps width and height for a 90° rotated page', async () => {
      const source = await readPdfEmbedSource(await sourcePdf(1, 90));
      expect(source?.pageSizes).toEqual([{ width: 842, height: 595 }]);
    });

    it(`caps the printed pages at ${MAX_EMBED_PAGES}`, async () => {
      const source = await readPdfEmbedSource(
        await sourcePdf(MAX_EMBED_PAGES + 2),
      );
      expect(source?.pageSizes).toHaveLength(MAX_EMBED_PAGES);
    });

    it('returns null for bytes that are not an embeddable PDF', async () => {
      expect(await readPdfEmbedSource(Buffer.from('nope'))).toBeNull();
      expect(
        await readPdfEmbedSource(Buffer.from('%PDF-1.7 truncated garbage')),
      ).toBeNull();
    });
  });

  describe('fitSlotPx', () => {
    const box = { width: 700, height: 1000 };

    it('shrinks a portrait page to the height when full width is too tall', () => {
      // Full width (700) would be ≈ 991 tall, over 97% of 1000, so scale to 970.
      expect(fitSlotPx({ width: 595, height: 842 }, box)).toEqual({
        width: 685,
        height: 970,
      });
    });

    it('fills the width for a landscape page', () => {
      expect(fitSlotPx({ width: 842, height: 595 }, box)).toEqual({
        width: 700,
        height: 494,
      });
    });

    it('never exceeds 97% of the printable height', () => {
      const tall = fitSlotPx({ width: 100, height: 1000 }, box);
      expect(tall.height).toBeLessThanOrEqual(970);
      expect(tall.width).toBe(97);
    });
  });

  describe('marker urls', () => {
    it('round-trips embed/page indices under a per-render prefix', () => {
      const prefix = newEmbedMarkerPrefix();
      const url = embedMarkerUrl(prefix, 3, 7);
      expect(url.startsWith('https://kaltros-pdf-embed.invalid/')).toBe(true);
      expect(parseEmbedMarkerUrl(prefix, url)).toEqual({
        embedIdx: 3,
        pageIdx: 7,
      });
    });

    it("ignores other URIs, including another render's markers", () => {
      const prefix = newEmbedMarkerPrefix();
      const other = embedMarkerUrl(newEmbedMarkerPrefix(), 0, 0);
      expect(parseEmbedMarkerUrl(prefix, other)).toBeNull();
      expect(parseEmbedMarkerUrl(prefix, 'https://example.com')).toBeNull();
      expect(parseEmbedMarkerUrl(prefix, `${prefix}x/1`)).toBeNull();
    });
  });

  describe('overlayEmbeddedPdfs', () => {
    it('draws the source page into the marker rect and removes the marker', async () => {
      const prefix = newEmbedMarkerPrefix();
      const source = await readPdfEmbedSource(await sourcePdf(1));
      const printed = await printedPdf([
        { uri: embedMarkerUrl(prefix, 0, 0), rect: [40, 100, 555, 800] },
      ]);

      const out = await PDFDocument.load(
        await overlayEmbeddedPdfs(printed, new Map([[0, source!]]), prefix),
      );

      expect(linkUris(out)).toEqual([]);
      expect(out.getPage(0).node.Annots()).toBeUndefined();
      expect(xObjectNames(out)).toHaveLength(1);
    });

    it('keeps real hyperlinks in the template', async () => {
      const prefix = newEmbedMarkerPrefix();
      const source = await readPdfEmbedSource(await sourcePdf(1));
      const printed = await printedPdf([
        { uri: 'https://lab.example/verify', rect: [10, 10, 100, 30] },
        { uri: embedMarkerUrl(prefix, 0, 0), rect: [40, 100, 555, 800] },
      ]);

      const out = await PDFDocument.load(
        await overlayEmbeddedPdfs(printed, new Map([[0, source!]]), prefix),
      );

      expect(linkUris(out)).toEqual(['https://lab.example/verify']);
    });

    it('embeds each source once for several of its pages', async () => {
      const prefix = newEmbedMarkerPrefix();
      const source = await readPdfEmbedSource(await sourcePdf(2));
      const printed = await printedPdf([
        { uri: embedMarkerUrl(prefix, 0, 0), rect: [40, 450, 555, 800] },
        { uri: embedMarkerUrl(prefix, 0, 1), rect: [40, 50, 555, 400] },
      ]);

      const out = await PDFDocument.load(
        await overlayEmbeddedPdfs(printed, new Map([[0, source!]]), prefix),
      );

      expect(xObjectNames(out)).toHaveLength(2);
      expect(linkUris(out)).toEqual([]);
    });

    it('draws a rotated source page without throwing', async () => {
      const prefix = newEmbedMarkerPrefix();
      const source = await readPdfEmbedSource(await sourcePdf(1, 90));
      const printed = await printedPdf([
        { uri: embedMarkerUrl(prefix, 0, 0), rect: [40, 300, 555, 700] },
      ]);

      const out = await PDFDocument.load(
        await overlayEmbeddedPdfs(printed, new Map([[0, source!]]), prefix),
      );

      expect(xObjectNames(out)).toHaveLength(1);
    });

    it('drops a marker whose source is missing without drawing anything', async () => {
      const prefix = newEmbedMarkerPrefix();
      const printed = await printedPdf([
        { uri: embedMarkerUrl(prefix, 5, 0), rect: [40, 100, 555, 800] },
      ]);

      const out = await PDFDocument.load(
        await overlayEmbeddedPdfs(printed, new Map(), prefix),
      );

      expect(linkUris(out)).toEqual([]);
      expect(xObjectNames(out)).toEqual([]);
    });

    it('leaves a PDF with no markers visually unchanged', async () => {
      const prefix = newEmbedMarkerPrefix();
      const printed = await printedPdf([
        { uri: 'https://lab.example/verify', rect: [10, 10, 100, 30] },
      ]);
      const out = await PDFDocument.load(
        await overlayEmbeddedPdfs(printed, new Map(), prefix),
      );
      const annots = out.getPage(0).node.Annots();
      expect(annots).toBeInstanceOf(PDFArray);
      expect(linkUris(out)).toEqual(['https://lab.example/verify']);
    });
  });
});
