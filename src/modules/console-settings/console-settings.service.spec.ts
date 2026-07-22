import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsoleSettingsService } from './console-settings.service';

/**
 * Unit coverage for the tenant-singleton upsert semantics and the
 * per-tier breach/warning cross-field guard.
 */
describe('ConsoleSettingsService', () => {
  const prismaMock = {
    consoleSetting: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  let service: ConsoleSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConsoleSettingsService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('getSettings', () => {
    it('upserts with the tenant id, creating defaults on first access', async () => {
      prismaMock.consoleSetting.upsert.mockResolvedValue({ tenantId: 't1' });

      const result = await service.getSettings('t1');

      expect(prismaMock.consoleSetting.upsert).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        create: { tenantId: 't1' },
        update: {},
      });
      expect(result).toEqual({ tenantId: 't1' });
    });
  });

  describe('saveSettings', () => {
    it('upserts only the provided fields (partial patch)', async () => {
      prismaMock.consoleSetting.findUnique.mockResolvedValue(null);
      prismaMock.consoleSetting.upsert.mockResolvedValue({
        tenantId: 't1',
        defaultPriority: 'Urgent',
      });

      const dto = { defaultPriority: 'Urgent' as const };
      const result = await service.saveSettings('t1', dto);

      expect(prismaMock.consoleSetting.upsert).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        create: { tenantId: 't1', ...dto },
        update: { ...dto },
      });
      expect(result).toEqual({ tenantId: 't1', defaultPriority: 'Urgent' });
    });

    it.each([
      ['routineWarningHours', 'routineBreachHours', 'Routine'],
      ['urgentWarningHours', 'urgentBreachHours', 'Urgent'],
      ['statWarningHours', 'statBreachHours', 'STAT'],
    ])(
      'rejects %s payload where breach does not exceed warning (%s tier)',
      async (warningKey, breachKey, label) => {
        prismaMock.consoleSetting.findUnique.mockResolvedValue(null);

        await expect(
          service.saveSettings('t1', {
            [warningKey]: 5,
            [breachKey]: 5,
          }),
        ).rejects.toThrow(
          new BadRequestException(
            `${label} breach hours must exceed warning hours`,
          ),
        );
        expect(prismaMock.consoleSetting.upsert).not.toHaveBeenCalled();
      },
    );

    it('rejects raising a breach value below an already-saved warning value', async () => {
      prismaMock.consoleSetting.findUnique.mockResolvedValue({
        routineWarningHours: 4,
        routineBreachHours: 8,
      });

      await expect(
        service.saveSettings('t1', { routineBreachHours: 2 }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.consoleSetting.upsert).not.toHaveBeenCalled();
    });

    it('allows breach hours strictly greater than warning hours', async () => {
      prismaMock.consoleSetting.findUnique.mockResolvedValue({
        routineWarningHours: 4,
        routineBreachHours: 8,
      });
      prismaMock.consoleSetting.upsert.mockResolvedValue({});

      await expect(
        service.saveSettings('t1', { routineBreachHours: 5 }),
      ).resolves.toBeDefined();
      expect(prismaMock.consoleSetting.upsert).toHaveBeenCalled();
    });
  });
});
