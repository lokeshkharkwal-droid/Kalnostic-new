import {
  STANDARD_SAMPLE_NAMES,
  resolveSampleName,
  summariseSampleNameNotes,
  type SampleNameNote,
} from './sample-name.util';

describe('resolveSampleName', () => {
  it('knows the 64 standard names the frontend dropdown offers', () => {
    expect(STANDARD_SAMPLE_NAMES).toHaveLength(64);
    expect(new Set(STANDARD_SAMPLE_NAMES).size).toBe(64);
  });

  it('leaves a name that is exactly a standard name alone', () => {
    expect(resolveSampleName('Serum-Gel')).toEqual({
      status: 'standard',
      name: 'Serum-Gel',
    });
    expect(resolveSampleName('Tissue-Fixed (10% NBF)')).toEqual({
      status: 'standard',
      name: 'Tissue-Fixed (10% NBF)',
    });
  });

  it.each([
    ['Pleural fluid', 'Pleural Fluid'],
    ['pleural FLUID', 'Pleural Fluid'],
    ['  Pleural   fluid ', 'Pleural Fluid'],
    ['Serum (Plain)', 'Serum-Plain'],
    ['serum plain', 'Serum-Plain'],
    ['SERUM-PLAIN', 'Serum-Plain'],
    ['Amniotic fluid', 'Amniotic Fluid'],
    ['WB EDTA', 'WB-EDTA'],
    ['wb-edta', 'WB-EDTA'],
    ['Swab-Dry/Plain', 'Swab-Dry / Plain'],
  ])('maps "%s" to the standard spelling "%s"', (typed, standard) => {
    expect(resolveSampleName(typed)).toEqual({
      status: 'mapped',
      name: standard,
    });
  });

  it.each([
    'X-Ray',
    'Urine-R',
    'Urine (Random)',
    'Swab',
    'Fluid',
    'Urine-24Hr',
    'Serum/Plasma',
    'Body Height',
    '2D ECHO',
    '-',
  ])('keeps "%s" exactly as typed (not a standard name)', (typed) => {
    expect(resolveSampleName(typed)).toEqual({ status: 'custom', name: typed });
  });

  it('never rejects: even odd text comes back unchanged', () => {
    for (const typed of [
      '---',
      '  ',
      'µg/dL sample',
      '日本語',
      'a'.repeat(100),
    ]) {
      const r = resolveSampleName(typed);
      expect(r.name).toBe(typed);
      expect(r.status).toBe('custom');
    }
  });

  it('is not fooled by a name that only looks similar (different words stay different)', () => {
    expect(resolveSampleName('Plasma-EDTA2').status).toBe('custom');
    expect(resolveSampleName('Plasma').status).toBe('custom');
    expect(resolveSampleName('Serum-Plain Extra').status).toBe('custom');
  });

  it('every standard name still maps to itself in any capitalisation (no two standard names are confusable)', () => {
    for (const name of STANDARD_SAMPLE_NAMES) {
      expect(resolveSampleName(name.toUpperCase()).name).toBe(name);
      expect(resolveSampleName(name.toLowerCase()).name).toBe(name);
    }
  });
});

describe('summariseSampleNameNotes', () => {
  const custom = (typed: string): SampleNameNote => ({ typed });
  const mapped = (typed: string, mappedTo: string): SampleNameNote => ({
    typed,
    mappedTo,
  });

  it('is empty when every name was already standard', () => {
    expect(
      summariseSampleNameNotes(new Map([['Row 2', []]]), new Set()),
    ).toEqual([]);
  });

  it('counts each test once per name, however many of its samples used it', () => {
    const notes = new Map<string, SampleNameNote[]>([
      ['Row 2', [custom('X-Ray'), custom('X-Ray')]],
      ['Row 3', [custom('X-Ray')]],
    ]);
    expect(summariseSampleNameNotes(notes, new Set())).toEqual([
      { name: 'X-Ray', tests: 2 },
    ]);
  });

  it('reports a tidied name with its standard spelling, separately from a custom one', () => {
    const notes = new Map<string, SampleNameNote[]>([
      ['Row 2', [mapped('Pleural fluid', 'Pleural Fluid'), custom('Urine-R')]],
    ]);
    expect(summariseSampleNameNotes(notes, new Set())).toEqual([
      { name: 'Pleural fluid', mappedTo: 'Pleural Fluid', tests: 1 },
      { name: 'Urine-R', tests: 1 },
    ]);
  });

  it('leaves out a skipped test: nothing it contained was saved', () => {
    const notes = new Map<string, SampleNameNote[]>([
      ['Row 2', [custom('X-Ray')]],
      ['Row 3', [custom('Urine-R')]],
    ]);
    expect(summariseSampleNameNotes(notes, new Set(['Row 2']))).toEqual([
      { name: 'Urine-R', tests: 1 },
    ]);
  });

  it('lists the most used first, then alphabetically', () => {
    const notes = new Map<string, SampleNameNote[]>([
      ['Row 2', [custom('Zeta'), custom('Alpha')]],
      ['Row 3', [custom('Zeta')]],
      ['Row 4', [custom('Beta')]],
    ]);
    expect(
      summariseSampleNameNotes(notes, new Set()).map((n) => n.name),
    ).toEqual(['Zeta', 'Alpha', 'Beta']);
  });
});
