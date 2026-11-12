import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync, IsArray, IsOptional, IsString } from 'class-validator';
import { ToStringArray } from './to-string-array.decorator';

class Probe {
  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsString({ each: true })
  names?: string[];
}

const parse = (raw: unknown) =>
  plainToInstance(Probe, { names: raw }, { enableImplicitConversion: true });

describe('ToStringArray', () => {
  it('wraps a single value (one repeated key arrives as a string)', () => {
    expect(parse('Serum-Gel').names).toEqual(['Serum-Gel']);
  });

  it('keeps several values as they are', () => {
    expect(parse(['Serum-Gel', 'WB-EDTA']).names).toEqual([
      'Serum-Gel',
      'WB-EDTA',
    ]);
  });

  it('does NOT split on commas or trim (names may contain both)', () => {
    expect(
      parse(['WB-EDTA (3ml) / CSF (1ml)', 'BUN, Body Fluid ']).names,
    ).toEqual(['WB-EDTA (3ml) / CSF (1ml)', 'BUN, Body Fluid ']);
  });

  it('drops empty entries and treats a missing / empty param as undefined', () => {
    expect(parse(['', 'A']).names).toEqual(['A']);
    expect(parse([]).names).toBeUndefined();
    expect(parse('').names).toBeUndefined();
    expect(parse(undefined).names).toBeUndefined();
  });

  it('passes validation as a string array', () => {
    expect(validateSync(parse(['A', 'B']))).toHaveLength(0);
  });
});
