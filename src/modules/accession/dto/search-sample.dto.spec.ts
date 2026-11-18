import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchSampleQueryDto } from './search-sample.dto';

/** The Search Sample query: a barcode and a menu. A control character (NUL ...) used to reach the database and cause a 500. */
describe('SearchSampleQueryDto', () => {
  const check = async (barcode: unknown, menu: unknown = 'IN_HOUSE') => {
    const dto = plainToInstance(SearchSampleQueryDto, { barcode, menu });
    const errors = await validate(dto);
    return { dto, errors };
  };

  it.each([
    '99010',
    'AbC-77',
    'LAB_10001',
    'LAB/10001',
    'a b',
    '₹99',
    'x'.repeat(50),
  ])('accepts %p', async (barcode) => {
    expect((await check(barcode)).errors).toHaveLength(0);
  });

  it('trims surrounding whitespace, including a trailing tab or newline from a scanner', async () => {
    const { dto, errors } = await check('  99010\t\n');
    expect(errors).toHaveLength(0);
    expect(dto.barcode).toBe('99010');
  });

  it.each([
    ['a NUL byte', '99010\u0000'],
    ['a NUL in the middle', '99\u000010'],
    ['a tab inside', '99\t010'],
    ['a newline inside', '99\n010'],
    ['a DEL character', '99\u007f010'],
    ['a percent sign (a wildcard in the database match)', '99%'],
    ['only a percent sign', '%'],
    ['a backslash', '99\\010'],
  ])('rejects %s', async (_name, barcode) => {
    const { errors } = await check(barcode);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe('barcode');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['51 characters', 'x'.repeat(51)],
    ['not a string', 123],
  ])('still rejects %s', async (_name, barcode) => {
    expect((await check(barcode)).errors.length).toBeGreaterThan(0);
  });
});
