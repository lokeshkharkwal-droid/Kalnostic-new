import { validate } from 'class-validator';
import {
  NOTE_MAX_LENGTH,
  NoteMaxLength,
  noteTooLongMessage,
} from './note-max-length.validator';

class Sample {
  @NoteMaxLength('Useful For')
  usefulFor?: string;
}

const errorsFor = async (value: unknown) => {
  const dto = new Sample();
  (dto as { usefulFor?: unknown }).usefulFor = value;
  return validate(dto);
};

describe('NoteMaxLength', () => {
  it('pins the shared limit: the frontend mirrors this number (NOTE_MAX_LENGTH in src/utils/text-limits.ts)', () => {
    // If you change this, change the frontend constant and its test in the same release.
    expect(NOTE_MAX_LENGTH).toBe(1_000_000);
  });

  it('accepts a note of exactly the limit', async () => {
    expect(await errorsFor('a'.repeat(NOTE_MAX_LENGTH))).toEqual([]);
  });

  it('rejects a note one character over the limit', async () => {
    const errors = await errorsFor('a'.repeat(NOTE_MAX_LENGTH + 1));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe('usefulFor');
    expect(Object.keys(errors[0]!.constraints ?? {})).toEqual(['maxLength']);
  });

  it('accepts typical long pasted text (200,000 characters, ten times the old limit)', async () => {
    expect(await errorsFor('<p>text</p>'.repeat(20_000))).toEqual([]);
  });

  it('accepts an empty note', async () => {
    expect(await errorsFor('')).toEqual([]);
  });

  it('names the field and both numbers so the user knows how much to cut', async () => {
    const [error] = await errorsFor('a'.repeat(NOTE_MAX_LENGTH + 5));

    expect(error!.constraints!.maxLength).toBe(
      'Useful For is too long (1,000,005 characters). The maximum is 1,000,000 characters.',
    );
  });
});

describe('noteTooLongMessage', () => {
  it('formats the numbers with thousands separators', () => {
    expect(noteTooLongMessage('Remarks', 2_500_000)).toBe(
      'Remarks is too long (2,500,000 characters). The maximum is 1,000,000 characters.',
    );
  });
});
