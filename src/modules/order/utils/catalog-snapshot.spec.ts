import {
  buildPanelSnapshot,
  buildTestSnapshot,
  shouldFreezeKeptLines,
} from './catalog-snapshot';

describe('catalog-snapshot', () => {
  const now = new Date('2026-11-27T10:00:00.000Z');

  it('captures name, code, prices, TAT and schedule of a test', () => {
    const snap = buildTestSnapshot(
      {
        testName: 'Complete Blood Count',
        testDisplayName: 'CBC',
        testCode: 'CBC01',
        departmentId: 'd1',
        listId: 'l1',
        listPrice: 500,
        emergencyPrice: 900,
        priceMsrp: 600,
        isAllowDiscounts: false,
        tatMinValue: 1,
        tatMinUnit: 'HOURS',
        tatMaxValue: 4,
        tatMaxUnit: 'HOURS',
        scheduleDays: ['MONDAY'],
        scheduleFrom: '09:00',
        scheduleTo: '17:00',
      },
      now,
    );
    expect(snap).toMatchObject({
      v: 1,
      kind: 'TEST',
      name: 'CBC',
      code: 'CBC01',
      listPrice: 500,
      emergencyPrice: 900,
      priceMsrp: 600,
      isAllowDiscounts: false,
      tat: { minValue: 1, maxValue: 4, maxUnit: 'HOURS' },
      schedule: { days: ['MONDAY'], from: '09:00', to: '17:00' },
      capturedAt: '2026-11-27T10:00:00.000Z',
    });
  });

  it('falls back to testName when there is no display name', () => {
    const snap = buildTestSnapshot(
      {
        testName: 'KFT',
        testDisplayName: null,
        testCode: 'K',
        departmentId: null,
        listId: null,
        listPrice: 0,
        emergencyPrice: 0,
        priceMsrp: 0,
        isAllowDiscounts: true,
        tatMinValue: null,
        tatMinUnit: null,
        tatMaxValue: null,
        tatMaxUnit: null,
        scheduleDays: [],
        scheduleFrom: null,
        scheduleTo: null,
      },
      now,
    );
    expect(snap.name).toBe('KFT');
  });

  it('inverts isDisableDiscount for a panel', () => {
    const snap = buildPanelSnapshot(
      {
        panelName: 'Lipid',
        panelCode: 'LP',
        departmentId: null,
        listId: 'l1',
        listPrice: 1200,
        priceMsrp: 1500,
        isDisableDiscount: true,
        tatMinValue: null,
        tatMinUnit: null,
        tatMaxValue: null,
        tatMaxUnit: null,
      },
      now,
    );
    expect(snap).toMatchObject({ kind: 'PANEL', isAllowDiscounts: false });
  });

  it('freezes only active orders', () => {
    expect(shouldFreezeKeptLines(true)).toBe(true);
    expect(shouldFreezeKeptLines(false)).toBe(false);
  });
});
