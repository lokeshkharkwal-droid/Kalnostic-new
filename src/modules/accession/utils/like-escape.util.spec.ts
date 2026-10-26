import { escapeLike } from './like-escape.util';

describe('escapeLike', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLike('Pathkind - Gurgaon')).toBe('Pathkind - Gurgaon');
    expect(escapeLike('')).toBe('');
    expect(escapeLike('O\'Brien "Labs" é漢字😀')).toBe(
      'O\'Brien "Labs" é漢字😀',
    );
  });

  it('puts a backslash in front of each LIKE metacharacter', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('_')).toBe('\\_');
    expect(escapeLike('\\')).toBe('\\\\');
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('escapes every occurrence, not only the first', () => {
    expect(escapeLike('%%__')).toBe('\\%\\%\\_\\_');
  });
});
