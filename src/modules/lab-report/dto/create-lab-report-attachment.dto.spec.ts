import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreateLabReportAttachmentDto } from './create-lab-report-attachment.dto';

async function errorsFor(
  obj: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(CreateLabReportAttachmentDto, obj));
}

/** True when the PDF-or-image rule (on `fileName`) failed. */
function hasFileTypeError(errors: ValidationError[]): boolean {
  return errors.some(
    (e) =>
      e.property === 'fileName' &&
      e.constraints?.isPdfOrImageWhenFileKind !== undefined,
  );
}

describe('CreateLabReportAttachmentDto — File+ PDF-or-image rule', () => {
  it('accepts a PDF "File +" upload', async () => {
    const errors = await errorsFor({
      kind: 'file',
      fileUrl: 'https://cdn.example.com/x/report.pdf',
      fileName: 'report.pdf',
    });
    expect(hasFileTypeError(errors)).toBe(false);
  });

  it('accepts an image "File +" upload', async () => {
    const errors = await errorsFor({
      kind: 'file',
      fileUrl: 'https://cdn.example.com/x/smear.png',
      fileName: 'smear.png',
    });
    expect(hasFileTypeError(errors)).toBe(false);
  });

  it('rejects a non-PDF, non-image "File +" upload', async () => {
    const errors = await errorsFor({
      kind: 'file',
      fileUrl: 'https://cdn.example.com/x/qc.xlsx',
      fileName: 'qc.xlsx',
    });
    expect(hasFileTypeError(errors)).toBe(true);
  });

  it('rejects an SVG "File +" upload (raster images only)', async () => {
    const errors = await errorsFor({
      kind: 'file',
      fileUrl: 'https://cdn.example.com/x/logo.svg',
      fileName: 'logo.svg',
    });
    expect(hasFileTypeError(errors)).toBe(true);
  });

  it('accepts a "File +" upload when only the URL path ends in .pdf', async () => {
    const errors = await errorsFor({
      kind: 'file',
      fileUrl: 'https://cdn.example.com/x/report.pdf?sig=abc',
      fileName: 'report',
    });
    expect(hasFileTypeError(errors)).toBe(false);
  });

  it('does not apply the rule to document uploads', async () => {
    const errors = await errorsFor({
      kind: 'document',
      fileUrl: 'https://cdn.example.com/x/notes.docx',
      fileName: 'notes.docx',
    });
    expect(hasFileTypeError(errors)).toBe(false);
  });

  it('does not apply the rule to image uploads', async () => {
    const errors = await errorsFor({
      kind: 'image',
      fileUrl: 'https://cdn.example.com/x/histogram.png',
      fileName: 'histogram.png',
    });
    expect(hasFileTypeError(errors)).toBe(false);
  });
});
