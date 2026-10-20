import { validate } from 'class-validator';
import {
  HasVisibleText,
  VISIBLE_CHARACTER,
} from './has-visible-text.decorator';

/**
 * A reason must contain something a person can SEE. `/\S/` only skips whitespace, so
 * a reason made of zero-width spaces (or other invisible characters) used to pass as
 * "filled in" while looking empty on screen.
 */
class Sample {
  @HasVisibleText()
  reason!: string;
}

const check = async (value: unknown) => {
  const s = new Sample();
  (s as unknown as Record<string, unknown>).reason = value;
  return validate(s);
};

const INVISIBLE: [string, string][] = [
  ['zero-width space U+200B', '\u200B'],
  ['zero-width non-joiner U+200C', '\u200C'],
  ['zero-width joiner U+200D', '\u200D'],
  ['word joiner U+2060', '\u2060'],
  ['soft hyphen U+00AD', '\u00AD'],
  ['byte-order mark U+FEFF', '\uFEFF'],
  ['left-to-right mark U+200E', '\u200E'],
  ['right-to-left mark U+200F', '\u200F'],
  ['Mongolian vowel separator U+180E', '\u180E'],
  ['combining grapheme joiner U+034F', '\u034F'],
  ['Hangul filler U+3164', '\u3164'],
  ['halfwidth Hangul filler U+FFA0', '\uFFA0'],
  ['Hangul choseong filler U+115F', '\u115F'],
  ['Hangul jungseong filler U+1160', '\u1160'],
  ['Braille blank U+2800', '\u2800'],
  ['null character', '\u0000'],
  ['escape control character', '\u001B'],
  ['line separator U+2028', '\u2028'],
  ['paragraph separator U+2029', '\u2029'],
  ['no-break space U+00A0', '\u00A0'],
  ['ideographic space U+3000', '\u3000'],
  ['a mix of every kind', ' \t\n\u200B\u200C\u2060\uFEFF\u00AD\u3164 '],
];

describe('HasVisibleText', () => {
  it.each(INVISIBLE)('refuses %s alone', async (_label, value) => {
    const errors = await check(value);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0]!.constraints!)[0]).toBe(
      'reason must contain at least one non-space character',
    );
  });

  it.each(INVISIBLE)(
    'refuses %s repeated many times',
    async (_label, value) => {
      expect(await check(value.repeat(50))).toHaveLength(1);
    },
  );

  it('refuses an empty string', async () => {
    expect(await check('')).toHaveLength(1);
  });

  it.each([
    ['a plain word', 'Damaged'],
    ['one character', 'x'],
    ['a digit', '7'],
    ['punctuation only', '?'],
    ['text with invisible characters around it', '\u200BDamaged\u200B'],
    ['text with spaces around it', '   Damaged   '],
    ['an invisible character between two words', 'Wrong\u200BTube'],
    ['accented letters', 'Échantillon endommagé'],
    ['Devanagari', 'नमूना क्षतिग्रस्त'],
    ['Chinese', '样本损坏'],
    ['Arabic', 'العينة تالفة'],
    ['an emoji', '🧪'],
    ['a Hangul syllable (not a filler)', '가'],
    ['a Braille pattern with dots', '\u2801'],
    ['a combining accent on a letter', 'e\u0301'],
  ])('accepts %s', async (_label, value) => {
    expect(await check(value)).toHaveLength(0);
  });

  it('refuses a value that is not text (leaves the type message to @IsString)', async () => {
    expect((await check(7)).length).toBeGreaterThan(0);
    expect((await check(null)).length).toBeGreaterThan(0);
    expect((await check(undefined)).length).toBeGreaterThan(0);
    expect((await check({ a: 1 })).length).toBeGreaterThan(0);
  });

  it('the pattern keeps no state between uses (no global flag)', () => {
    expect(VISIBLE_CHARACTER.global).toBe(false);
    expect(VISIBLE_CHARACTER.test('a')).toBe(true);
    expect(VISIBLE_CHARACTER.test('a')).toBe(true);
  });
});
