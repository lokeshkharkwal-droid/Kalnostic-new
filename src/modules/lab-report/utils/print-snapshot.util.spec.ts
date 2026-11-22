import { AbnormalFlag, ResultFlagOption, ResultType } from '@prisma/client';
import {
  PRINT_SNAPSHOT_VERSION,
  buildResultPrintSnapshot,
  parseResultPrintSnapshot,
} from './print-snapshot.util';

const param = (over: Record<string, unknown> = {}) => ({
  parameterName: 'Glucose',
  groupName: 'Chemistry' as string | null,
  sortOrder: 3,
  resultType: ResultType.QUANTITATIVE as ResultType | null,
  abnormalFlagLogic: AbnormalFlag.BOLD_ONLY as AbnormalFlag | null,
  notes: 'fasting' as string | null,
  ...over,
});
const val = (over: Record<string, unknown> = {}) => ({
  observed1: '150' as string | null,
  observed2: null as string | null,
  flagOption: ResultFlagOption.DEFAULT,
  highlightLogic: null as AbnormalFlag | null,
  ...over,
});
const RANGE = { lowerLimit: 70, upperLimit: 110 };

describe('buildResultPrintSnapshot', () => {
  it('freezes the decision (same function the print uses) and the parameter fields', () => {
    expect(buildResultPrintSnapshot(param(), val(), RANGE)).toEqual({
      v: PRINT_SNAPSHOT_VERSION,
      o1: { style: AbnormalFlag.BOLD_ONLY, label: null, abnormal: true },
      o2: { style: null, label: null, abnormal: false },
      name: 'Glucose',
      group: 'Chemistry',
      order: 3,
      type: ResultType.QUANTITATIVE,
      note: 'fasting',
    });
  });

  it('Observed 1 and Observed 2 are decided separately', () => {
    const s = buildResultPrintSnapshot(
      param(),
      val({ observed1: '90', observed2: '150' }),
      RANGE,
    );
    expect(s.o1.style).toBeNull();
    expect(s.o2.style).toBe(AbnormalFlag.BOLD_ONLY);
  });

  it('a High Low style freezes the word too', () => {
    const s = buildResultPrintSnapshot(
      param({ abnormalFlagLogic: AbnormalFlag.RED_HIGH_LOW }),
      val({ observed1: '50' }),
      RANGE,
    );
    expect(s.o1).toEqual({
      style: AbnormalFlag.RED_HIGH_LOW,
      label: 'Low',
      abnormal: true,
    });
  });

  it('a blank parameter style freezes Normal under Default, and the Bold and Red fallback under Highlight', () => {
    expect(
      buildResultPrintSnapshot(param({ abnormalFlagLogic: null }), val(), RANGE)
        .o1.style,
    ).toBeNull();
    expect(
      buildResultPrintSnapshot(
        param({ abnormalFlagLogic: null }),
        val({ flagOption: ResultFlagOption.HIGHLIGHT }),
        RANGE,
      ).o1,
    ).toEqual({
      style: AbnormalFlag.BOLD_AND_RED,
      label: null,
      abnormal: false,
    });
  });

  it('a missing group freezes as an empty string', () => {
    expect(
      buildResultPrintSnapshot(param({ groupName: null }), val(), RANGE).group,
    ).toBe('');
  });
});

describe('parseResultPrintSnapshot', () => {
  const good = buildResultPrintSnapshot(param(), val(), RANGE);

  it('round-trips a snapshot through JSON', () => {
    expect(parseResultPrintSnapshot(JSON.parse(JSON.stringify(good)))).toEqual(
      good,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 1],
    ['an array', []],
    ['an empty object', {}],
    ['another version', { ...good, v: 2 }],
    ['no version', { ...good, v: undefined }],
    ['a missing mark', { ...good, o2: undefined }],
    ['an unknown style', { ...good, o1: { ...good.o1, style: 'PINK' } }],
    ['an unknown label', { ...good, o1: { ...good.o1, label: 'Huge' } }],
    [
      'a non-boolean abnormal',
      { ...good, o1: { ...good.o1, abnormal: 'yes' } },
    ],
    ['a non-string name', { ...good, name: 5 }],
    ['a non-string group', { ...good, group: null }],
    ['a non-numeric order', { ...good, order: 'first' }],
    ['an infinite order', { ...good, order: Infinity }],
    ['an unknown result type', { ...good, type: 'MAGIC' }],
    ['a non-string note', { ...good, note: 4 }],
  ])('refuses %s', (_n, bad) => {
    expect(parseResultPrintSnapshot(bad)).toBeNull();
  });

  it('accepts a null type and a null note', () => {
    const s = parseResultPrintSnapshot({ ...good, type: null, note: null });
    expect(s).toMatchObject({ type: null, note: null });
  });

  it('keeps only the known fields (an extra key is dropped)', () => {
    const s = parseResultPrintSnapshot({ ...good, evil: '<script>' });
    expect(s).not.toHaveProperty('evil');
  });
});
