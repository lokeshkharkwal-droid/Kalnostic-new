import { contentMatchesMime } from './file-signature.util';

/** Build a buffer that starts with `head` (and pads so webp offset checks run). */
function withHead(...head: number[]): Buffer {
  return Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
}

const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = withHead(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = withHead(0xff, 0xd8, 0xff);
const GIF = Buffer.from('GIF89a........');
// RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP).
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe('contentMatchesMime', () => {
  it('accepts matching signatures', () => {
    expect(contentMatchesMime(PDF, 'application/pdf')).toBe(true);
    expect(contentMatchesMime(PNG, 'image/png')).toBe(true);
    expect(contentMatchesMime(JPEG, 'image/jpeg')).toBe(true);
    expect(contentMatchesMime(JPEG, 'image/jpg')).toBe(true);
    expect(contentMatchesMime(GIF, 'image/gif')).toBe(true);
    expect(contentMatchesMime(WEBP, 'image/webp')).toBe(true);
  });

  it('rejects a mislabelled file (bytes do not match the declared type)', () => {
    // A PNG uploaded claiming to be a PDF, and junk claiming to be a PNG.
    expect(contentMatchesMime(PNG, 'application/pdf')).toBe(false);
    expect(contentMatchesMime(Buffer.from('not an image'), 'image/png')).toBe(
      false,
    );
    expect(contentMatchesMime(PDF, 'image/jpeg')).toBe(false);
  });

  it('is case-insensitive on the MIME type', () => {
    expect(contentMatchesMime(PDF, 'APPLICATION/PDF')).toBe(true);
  });

  it('allows types it has no signature for (CSV, Office, SVG, text)', () => {
    const anything = Buffer.from('a,b,c\n1,2,3');
    expect(contentMatchesMime(anything, 'text/csv')).toBe(true);
    expect(contentMatchesMime(anything, 'image/svg+xml')).toBe(true);
    expect(
      contentMatchesMime(
        anything,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
  });

  it('rejects when the buffer is too short for the signature', () => {
    expect(contentMatchesMime(Buffer.from([0x89]), 'image/png')).toBe(false);
  });
});
