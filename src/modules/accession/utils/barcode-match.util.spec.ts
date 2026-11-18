import { barcodeEquals } from './barcode-match.util';

/**
 * The barcode match: exact and ignoring capitals, but never a wildcard match. Prisma sends a case-insensitive match as
 * `ILIKE` and a backslash does not switch the wildcards off, so a code with `_` (a legal separator) gets plain equality.
 */
describe('barcodeEquals', () => {
  it.each(['10050', 'AbC-77', 'abc-77', 'LAB/10001', 'A.B'])(
    'ignores capitals for %s',
    (code) => {
      expect(barcodeEquals(code)).toEqual({
        equals: code,
        mode: 'insensitive',
      });
    },
  );

  it.each(['9901_', 'LAB_10001', '_', '%', '9%', 'a\\b'])(
    'uses plain (case-sensitive) equality for %s, so no character is a wildcard',
    (code) => {
      expect(barcodeEquals(code)).toEqual({ equals: code });
    },
  );
});
