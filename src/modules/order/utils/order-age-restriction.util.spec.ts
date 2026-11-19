import { AgeUnit } from '@prisma/client';
import {
  AgeGateLookup,
  ageViolationMessage,
  findAgeViolations,
  linesToAgeCheck,
} from './order-age-restriction.util';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('order age gate utils', () => {
  const lookup: AgeGateLookup = {
    restricted: new Map([
      [
        'adult',
        {
          testName: 'Vitamin B12',
          limit: {
            minAgeValue: 18,
            minAgeUnit: AgeUnit.YEARS,
            maxAgeValue: 60,
            maxAgeUnit: AgeUnit.YEARS,
          },
        },
      ],
      [
        'neonate',
        {
          testName: 'Newborn Screen',
          limit: {
            minAgeValue: 1,
            minAgeUnit: AgeUnit.DAYS,
            maxAgeValue: 28,
            maxAgeUnit: AgeUnit.DAYS,
          },
        },
      ],
    ]),
    panelMembers: new Map([['p1', ['free', 'adult']]]),
    panelNames: new Map([['p1', 'Lipid Profile']]),
  };

  describe('findAgeViolations', () => {
    it('ignores unrestricted tests and direct lines', () => {
      expect(
        findAgeViolations(
          [{ branchLabTestId: 'free' }, {}],
          lookup,
          day('2021-01-01'),
          day('2026-11-11'),
        ),
      ).toEqual([]);
    });

    it('reports a test line and a panel line separately', () => {
      expect(
        findAgeViolations(
          [{ branchLabTestId: 'adult' }, { branchLabPanelId: 'p1' }],
          lookup,
          day('2021-01-01'),
          day('2026-11-11'),
        ),
      ).toEqual([
        {
          panelName: null,
          testName: 'Vitamin B12',
          allowedRange: '18 Years - 60 Years',
        },
        {
          panelName: 'Lipid Profile',
          testName: 'Vitamin B12',
          allowedRange: '18 Years - 60 Years',
        },
      ]);
    });

    it('handles day-unit ranges (newborn: day 0 fails, day 1 and day 28 pass, day 29 fails)', () => {
      const check = (dob: string) =>
        findAgeViolations(
          [{ branchLabTestId: 'neonate' }],
          lookup,
          day(dob),
          day('2026-11-11'),
        ).length;
      expect(check('2026-11-11')).toBe(1);
      expect(check('2026-11-10')).toBe(0);
      expect(check('2026-10-14')).toBe(0);
      expect(check('2026-10-13')).toBe(1);
    });
  });

  describe('linesToAgeCheck', () => {
    const stored = [
      { id: 'oi1', branchLabTestId: 'adult', branchLabPanelId: null },
      { id: 'oi2', branchLabTestId: null, branchLabPanelId: 'p1' },
    ];

    it('checks nothing when the update leaves items untouched', () => {
      expect(linesToAgeCheck(undefined, stored, false)).toEqual([]);
    });

    it('checks only new lines on a normal edit', () => {
      expect(
        linesToAgeCheck(
          [
            { id: 'oi1', branchLabTestId: 'adult' },
            { branchLabTestId: 'neonate' },
          ],
          stored,
          false,
        ),
      ).toEqual([{ branchLabTestId: 'neonate' }]);
    });

    it('treats a kept id pointing at a different test as new', () => {
      expect(
        linesToAgeCheck(
          [{ id: 'oi1', branchLabTestId: 'neonate' }],
          stored,
          false,
        ),
      ).toEqual([{ id: 'oi1', branchLabTestId: 'neonate' }]);
    });

    it('checks every effective line when the order is being finalized', () => {
      expect(linesToAgeCheck(undefined, stored, true)).toEqual(stored);
      const incoming = [{ id: 'oi1', branchLabTestId: 'adult' }];
      expect(linesToAgeCheck(incoming, stored, true)).toEqual(incoming);
    });
  });

  it('builds a readable message with the allowed range', () => {
    expect(
      ageViolationMessage('5 Years', [
        {
          panelName: null,
          testName: 'Vitamin B12',
          allowedRange: '18 Years - 60 Years',
        },
        {
          panelName: 'Lipid Profile',
          testName: 'X',
          allowedRange: '1 Day - 1 Year',
        },
      ]),
    ).toBe(
      'Patient\'s age (5 Years) does not meet the age requirement for "Vitamin B12" (allowed age: 18 Years - 60 Years), panel "Lipid Profile" (test "X" allows age 1 Day - 1 Year).',
    );
  });
});
