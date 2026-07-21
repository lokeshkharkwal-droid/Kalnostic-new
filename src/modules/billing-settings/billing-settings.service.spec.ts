import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingSettingsService } from './billing-settings.service';

/**
 * Unit coverage for the tenant-singleton upsert semantics and the
 * counter/manager discount cross-field guard.
 */
describe('BillingSettingsService', () => {
  const prismaMock = {
    billingSetting: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  let service: BillingSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingSettingsService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('getSettings', () => {
    it('upserts with the tenant id, creating defaults on first access', async () => {
      prismaMock.billingSetting.upsert.mockResolvedValue({ tenantId: 't1' });

      const result = await service.getSettings('t1');

      expect(prismaMock.billingSetting.upsert).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        create: { tenantId: 't1' },
        update: {},
      });
      expect(result).toEqual({ tenantId: 't1' });
    });
  });

  describe('saveSettings', () => {
    it('upserts only the provided fields (partial patch)', async () => {
      prismaMock.billingSetting.findUnique.mockResolvedValue(null);
      prismaMock.billingSetting.upsert.mockResolvedValue({
        tenantId: 't1',
        gstMode: 'EXCLUSIVE',
      });

      const dto = { gstMode: 'EXCLUSIVE' as const };
      const result = await service.saveSettings('t1', dto);

      expect(prismaMock.billingSetting.upsert).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        create: { tenantId: 't1', ...dto },
        update: { ...dto },
      });
      expect(result).toEqual({ tenantId: 't1', gstMode: 'EXCLUSIVE' });
    });

    it('rejects a counterDiscountMax above managerDiscountMax in the same payload', async () => {
      prismaMock.billingSetting.findUnique.mockResolvedValue(null);

      await expect(
        service.saveSettings('t1', {
          counterDiscountMax: 50,
          managerDiscountMax: 20,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.billingSetting.upsert).not.toHaveBeenCalled();
    });

    it('rejects raising counterDiscountMax above an already-saved managerDiscountMax', async () => {
      prismaMock.billingSetting.findUnique.mockResolvedValue({
        counterDiscountMax: 10,
        managerDiscountMax: 25,
      });

      await expect(
        service.saveSettings('t1', { counterDiscountMax: 30 }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.billingSetting.upsert).not.toHaveBeenCalled();
    });

    it('allows counterDiscountMax equal to managerDiscountMax', async () => {
      prismaMock.billingSetting.findUnique.mockResolvedValue({
        counterDiscountMax: 10,
        managerDiscountMax: 25,
      });
      prismaMock.billingSetting.upsert.mockResolvedValue({});

      await expect(
        service.saveSettings('t1', { counterDiscountMax: 25 }),
      ).resolves.toBeDefined();
      expect(prismaMock.billingSetting.upsert).toHaveBeenCalled();
    });
  });

  describe('getEnums', () => {
    it('returns the enum lists consumed by the frontend selects', () => {
      const enums = service.getEnums();

      expect(enums).toHaveProperty('invoiceResetCycles');
      expect(enums).toHaveProperty('gstModes');
      expect(enums).toHaveProperty('refundApprovalLevels');
      expect(enums).not.toHaveProperty('paymentModes');
    });
  });
});
