import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveDateFilterPreferenceDto } from './dto/save-date-filter-preference.dto';
import { UserPreferenceService } from './user-preference.service';
import {
  InvalidDateFilterRangeException,
  InvalidDateFilterScreenException,
} from './exceptions/user-preference.exceptions';

/** First argument of a mock's first call, typed for assertions. */
function firstCall<T>(fn: jest.Mock): T {
  const call = fn.mock.calls[0] as [T] | undefined;
  if (!call) throw new Error('mock was not called');
  return call[0];
}

/** Per-user default date filter: scoping, upsert shape, CUSTOM rules, reset. */
describe('UserPreferenceService — date filter', () => {
  const prismaMock = {
    userDateFilterPreference: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const updatedAt = new Date('2026-11-10T06:00:00.000Z');
  let service: UserPreferenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserPreferenceService(prismaMock as unknown as PrismaService);
  });

  describe('getDateFilter', () => {
    it('reads only the caller’s live row (tenant + person + screen, not deleted)', async () => {
      prismaMock.userDateFilterPreference.findFirst.mockResolvedValue({
        screenKey: 'registration-billings',
        preset: 'LAST_7_DAYS',
        dateFrom: null,
        dateTo: null,
        updatedAt,
      });

      const res = await service.getDateFilter(
        't1',
        'p1',
        'registration-billings',
      );

      expect(
        prismaMock.userDateFilterPreference.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          tenantId: 't1',
          personId: 'p1',
          screenKey: 'registration-billings',
          deletedAt: null,
        },
      });
      expect(res).toEqual({
        screenKey: 'registration-billings',
        preset: 'LAST_7_DAYS',
        dateFrom: null,
        dateTo: null,
        updatedAt,
      });
    });

    it('returns null when nothing is saved', async () => {
      prismaMock.userDateFilterPreference.findFirst.mockResolvedValue(null);
      await expect(
        service.getDateFilter('t1', 'p1', 'finance-billings'),
      ).resolves.toBeNull();
    });

    it('formats CUSTOM @db.Date values as YYYY-MM-DD', async () => {
      prismaMock.userDateFilterPreference.findFirst.mockResolvedValue({
        screenKey: 'registration-order-console',
        preset: 'CUSTOM',
        dateFrom: new Date('2026-10-01T00:00:00.000Z'),
        dateTo: new Date('2026-10-31T00:00:00.000Z'),
        updatedAt,
      });
      const res = await service.getDateFilter(
        't1',
        'p1',
        'registration-order-console',
      );
      expect(res?.dateFrom).toBe('2026-10-01');
      expect(res?.dateTo).toBe('2026-10-31');
    });

    it('rejects an unknown screen without touching the database', async () => {
      await expect(
        service.getDateFilter('t1', 'p1', 'patients'),
      ).rejects.toBeInstanceOf(InvalidDateFilterScreenException);
      expect(
        prismaMock.userDateFilterPreference.findFirst,
      ).not.toHaveBeenCalled();
    });
  });

  describe('saveDateFilter', () => {
    it('upserts a relative preset with null dates (even if dates were sent) and revives a deleted row', async () => {
      prismaMock.userDateFilterPreference.upsert.mockResolvedValue({
        screenKey: 'registration-billings',
        preset: 'LAST_7_DAYS',
        dateFrom: null,
        dateTo: null,
        updatedAt,
      });

      await service.saveDateFilter('t1', 'p1', 'registration-billings', {
        preset: 'LAST_7_DAYS',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-02',
      });

      expect(prismaMock.userDateFilterPreference.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_personId_screenKey: {
            tenantId: 't1',
            personId: 'p1',
            screenKey: 'registration-billings',
          },
        },
        create: {
          tenantId: 't1',
          personId: 'p1',
          screenKey: 'registration-billings',
          preset: 'LAST_7_DAYS',
          dateFrom: null,
          dateTo: null,
        },
        update: {
          preset: 'LAST_7_DAYS',
          dateFrom: null,
          dateTo: null,
          deletedAt: null,
        },
      });
    });

    it('stores CUSTOM dates as UTC-midnight calendar dates', async () => {
      prismaMock.userDateFilterPreference.upsert.mockResolvedValue({
        screenKey: 'finance-billings',
        preset: 'CUSTOM',
        dateFrom: new Date('2026-10-01T00:00:00.000Z'),
        dateTo: new Date('2026-10-05T00:00:00.000Z'),
        updatedAt,
      });

      const res = await service.saveDateFilter('t1', 'p1', 'finance-billings', {
        preset: 'CUSTOM',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-05',
      });

      const call = firstCall<{ create: { dateFrom: Date; dateTo: Date } }>(
        prismaMock.userDateFilterPreference.upsert,
      );
      expect(call.create.dateFrom.toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
      expect(call.create.dateTo.toISOString()).toBe('2026-10-05T00:00:00.000Z');
      expect(res).toMatchObject({
        preset: 'CUSTOM',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-05',
      });
    });

    it('accepts a single-day CUSTOM range', async () => {
      prismaMock.userDateFilterPreference.upsert.mockResolvedValue({
        screenKey: 'finance-billings',
        preset: 'CUSTOM',
        dateFrom: new Date('2026-10-01T00:00:00.000Z'),
        dateTo: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt,
      });
      await expect(
        service.saveDateFilter('t1', 'p1', 'finance-billings', {
          preset: 'CUSTOM',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-01',
        }),
      ).resolves.toMatchObject({
        dateFrom: '2026-10-01',
        dateTo: '2026-10-01',
      });
    });

    it('rejects a CUSTOM range whose start is after its end', async () => {
      await expect(
        service.saveDateFilter('t1', 'p1', 'finance-billings', {
          preset: 'CUSTOM',
          dateFrom: '2026-10-05',
          dateTo: '2026-10-01',
        }),
      ).rejects.toBeInstanceOf(InvalidDateFilterRangeException);
      expect(prismaMock.userDateFilterPreference.upsert).not.toHaveBeenCalled();
    });

    it('rejects an unknown screen', async () => {
      await expect(
        service.saveDateFilter('t1', 'p1', 'nope', { preset: 'TODAY' }),
      ).rejects.toBeInstanceOf(InvalidDateFilterScreenException);
    });
  });

  describe('screen keys', () => {
    it.each([
      'registration-billings',
      'finance-billings',
      'registration-order-console',
      'accession-inhouse-orders',
      'accession-referral-orders',
      'technician-reporting',
    ])('accepts %s', (key) => {
      expect(service.assertScreenKey(key)).toBe(key);
    });

    it('rejects external referral / outsource (no saved default there)', () => {
      expect(() =>
        service.assertScreenKey('accession-external-referral-orders'),
      ).toThrow(InvalidDateFilterScreenException);
      expect(() => service.assertScreenKey('accession-outsource')).toThrow(
        InvalidDateFilterScreenException,
      );
    });
  });

  describe('resetDateFilter', () => {
    it('soft-deletes only the caller’s live row for that screen', async () => {
      prismaMock.userDateFilterPreference.updateMany.mockResolvedValue({
        count: 1,
      });

      const res = await service.resetDateFilter(
        't1',
        'p1',
        'registration-order-console',
      );

      const call = firstCall<{ where: unknown; data: { deletedAt: unknown } }>(
        prismaMock.userDateFilterPreference.updateMany,
      );
      expect(call.where).toEqual({
        tenantId: 't1',
        personId: 'p1',
        screenKey: 'registration-order-console',
        deletedAt: null,
      });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(res).toEqual({
        screenKey: 'registration-order-console',
        reset: true,
      });
    });
  });
});

/** Body validation of the save request (the global ValidationPipe runs this). */
describe('SaveDateFilterPreferenceDto', () => {
  const errorsFor = (body: Record<string, unknown>) =>
    validate(plainToInstance(SaveDateFilterPreferenceDto, body));

  it('accepts LAST_15_DAYS (the no-default fallback, also selectable)', async () => {
    expect(await errorsFor({ preset: 'LAST_15_DAYS' })).toHaveLength(0);
  });

  it('rejects an unknown preset', async () => {
    const errors = await errorsFor({ preset: 'LAST_14_DAYS' });
    expect(errors.map((e) => e.property)).toEqual(['preset']);
  });
});
