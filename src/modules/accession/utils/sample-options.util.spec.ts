import {
  STANDARD_SAMPLE_TYPES,
  buildSampleOptions,
} from './sample-options.util';

describe('buildSampleOptions', () => {
  it('counts null and blank values as "Not set", never as options', () => {
    const r = buildSampleOptions(
      [
        { value: null, count: 5 },
        { value: '', count: 2 },
        { value: 'Serum-Plain', count: 1 },
      ],
      'name',
    );
    expect(r.notSetCount).toBe(7);
    expect(r.options.map((o) => o.label)).toEqual(['Serum-Plain']);
  });

  it('merges spelling variants into the standard name and keeps every spelling', () => {
    const r = buildSampleOptions(
      [
        { value: 'Serum (Plain)', count: 250 },
        { value: 'Serum-Plain', count: 179 },
        { value: 'serum plain', count: 1 },
      ],
      'name',
    );
    expect(r.options).toHaveLength(1);
    expect(r.options[0]).toMatchObject({
      label: 'Serum-Plain',
      isStandard: true,
      count: 430,
    });
    expect(r.options[0]!.values).toEqual(
      ['Serum (Plain)', 'Serum-Plain', 'serum plain'].sort(),
    );
  });

  it('lists a standard entry only when the branch has it', () => {
    const r = buildSampleOptions([{ value: 'Stool', count: 3 }], 'name');
    expect(r.options.map((o) => o.label)).toEqual(['Stool']);
  });

  it('lists names outside the standard list as their own non-standard entries, after the standard ones', () => {
    const r = buildSampleOptions(
      [
        { value: 'X-Ray', count: 308 },
        { value: 'Urine-R', count: 4 },
        { value: 'Stool', count: 3 },
      ],
      'name',
    );
    expect(r.options.map((o) => [o.label, o.isStandard])).toEqual([
      ['Stool', true],
      ['Urine-R', false],
      ['X-Ray', false],
    ]);
  });

  it('labels a non-standard entry with its most used spelling', () => {
    const r = buildSampleOptions(
      [
        { value: 'X-ray', count: 2 },
        { value: 'X-Ray', count: 9 },
      ],
      'name',
    );
    expect(r.options).toHaveLength(1);
    expect(r.options[0]).toMatchObject({ label: 'X-Ray', count: 11 });
  });

  it('keeps a value with no letters or digits as its own entry', () => {
    const r = buildSampleOptions(
      [
        { value: '-', count: 1 },
        { value: '--', count: 1 },
      ],
      'name',
    );
    expect(r.options.map((o) => o.label).sort()).toEqual(['-', '--']);
  });

  it('uses the sample type list for the type field', () => {
    expect(STANDARD_SAMPLE_TYPES).toHaveLength(23);
    const r = buildSampleOptions(
      [
        { value: 'whole blood', count: 4 },
        { value: 'Blood', count: 147 },
      ],
      'type',
    );
    expect(r.options.map((o) => [o.label, o.isStandard])).toEqual([
      ['Whole Blood', true],
      ['Blood', false],
    ]);
  });

  it('search matches the label or any spelling, ignoring case, and does not touch the Not set count', () => {
    const rows = [
      { value: 'Serum (Plain)', count: 2 },
      { value: 'Stool', count: 1 },
      { value: null, count: 9 },
    ];
    const r = buildSampleOptions(rows, 'name', ' PLAIN ');
    expect(r.options.map((o) => o.label)).toEqual(['Serum-Plain']);
    expect(r.notSetCount).toBe(9);
  });
});
