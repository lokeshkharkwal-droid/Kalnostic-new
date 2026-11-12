import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListTransfersDto } from '../dto/list-transfers.dto';
import {
  DERIVED_TRANSFER_SORT_KEYS,
  TRANSFER_SORT_KEYS,
  isDerivedTransferSort,
  sortIdsByLabel,
  transferOrderBy,
} from './transfer-sort.util';

describe('transferOrderBy', () => {
  const tieBreak = [{ createdAt: 'desc' }, { id: 'desc' }];

  it('defaults to newest first with the id as tie-breaker', () => {
    expect(transferOrderBy(undefined)).toEqual(tieBreak);
  });

  it('every non-derived key sorts then falls back to the default order', () => {
    const direct = TRANSFER_SORT_KEYS.filter((k) => !isDerivedTransferSort(k));
    expect(direct.length).toBeGreaterThan(0);
    for (const key of direct) {
      if (isDerivedTransferSort(key)) continue;
      const order = transferOrderBy(key, 'desc');
      expect(order.length).toBeGreaterThan(tieBreak.length);
      expect(order.slice(-2)).toEqual(tieBreak);
    }
  });

  it('send date sorts the date, then the time, empty last', () => {
    expect(transferOrderBy('sendDate', 'asc').slice(0, 2)).toEqual([
      { sendDate: { sort: 'asc', nulls: 'last' } },
      { sendTime: { sort: 'asc', nulls: 'last' } },
    ]);
  });

  it('patient name sorts first name then last name, through the sample and order', () => {
    expect(transferOrderBy('patientName', 'desc').slice(0, 2)).toEqual([
      { sample: { order: { patient: { firstName: 'desc' } } } },
      {
        sample: {
          order: { patient: { lastName: { sort: 'desc', nulls: 'last' } } },
        },
      },
    ]);
  });

  it('order id and order date read the linked order', () => {
    expect(transferOrderBy('orderCode', 'asc')[0]).toEqual({
      sample: { order: { orderCode: 'asc' } },
    });
    expect(transferOrderBy('orderDate', 'desc')[0]).toEqual({
      sample: { order: { orderDate: 'desc' } },
    });
  });

  it('transfer status uses the enum, declared in lifecycle order', () => {
    expect(transferOrderBy('transferStatus', 'asc')[0]).toEqual({
      transferStatus: 'asc',
    });
  });
});

describe('isDerivedTransferSort', () => {
  it('flags only the name-based sorts', () => {
    for (const key of DERIVED_TRANSFER_SORT_KEYS) {
      expect(isDerivedTransferSort(key)).toBe(true);
    }
    expect(isDerivedTransferSort('barcode')).toBe(false);
    expect(isDerivedTransferSort(undefined)).toBe(false);
  });

  it('does not list Test Name (waits for the one-row-per-barcode decision)', () => {
    expect(TRANSFER_SORT_KEYS as readonly string[]).not.toContain('testName');
  });
});

describe('sortIdsByLabel', () => {
  const rows = [
    { id: 'n1', label: null },
    { id: 'b', label: 'branch b' },
    { id: 'a', label: 'Apollo' },
    { id: 'c', label: 'Çentral' },
    { id: 'a2', label: 'apollo' },
    { id: 'e', label: '' },
  ];

  it('is alphabetical ignoring capitals and accents; ties keep the arrival order', () => {
    expect(sortIdsByLabel(rows, 'asc')).toEqual([
      'a',
      'a2',
      'b',
      'c',
      'n1',
      'e',
    ]);
  });

  it('descending reverses the names but a missing name is still last', () => {
    expect(sortIdsByLabel(rows, 'desc')).toEqual([
      'c',
      'b',
      'a',
      'a2',
      'n1',
      'e',
    ]);
  });

  it('is stable for rows with no name', () => {
    expect(
      sortIdsByLabel(
        [
          { id: '1', label: null },
          { id: '2', label: null },
        ],
        'asc',
      ),
    ).toEqual(['1', '2']);
  });
});

describe('ListTransfersDto - sort params', () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(ListTransfersDto, plain)).map(
      (e) => e.property,
    );

  it('accepts every allowed column and either direction', () => {
    for (const sortBy of TRANSFER_SORT_KEYS) {
      expect(errors({ sortBy, sortOrder: 'desc' })).toEqual([]);
    }
    expect(errors({ sortOrder: 'asc' })).toEqual([]);
  });

  it('rejects a column or direction that is not allowed (400, not a Prisma error)', () => {
    expect(errors({ sortBy: 'testName' })).toEqual(['sortBy']);
    expect(errors({ sortBy: 'password' })).toEqual(['sortBy']);
    expect(errors({ sortOrder: 'sideways' })).toEqual(['sortOrder']);
  });
});
