import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { RegistrationSettingsService } from './registration-settings.service';
import { ConflictingDiscountModeException } from './exceptions/registration-settings.exceptions';
import { ValidationException } from '../../common/exceptions/kaltros.exception';

/**
 * Unit coverage for the branch-scoped upsert semantics and the two business
 * rules from the LIMS Settings doc: min/max threshold ordering and the
 * mutually-exclusive discount-mode toggles.
 */
describe('RegistrationSettingsService', () => {
  const prismaMock = {
    registrationSetting: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const branchServiceMock = {
    findById: jest.fn(),
  };

  let service: RegistrationSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    branchServiceMock.findById.mockResolvedValue({ id: 'b1', tenantId: 't1' });
    service = new RegistrationSettingsService(
      prismaMock as unknown as PrismaService,
      branchServiceMock as unknown as BranchService,
    );
  });

  describe('getForBranch', () => {
    it('validates the branch then upserts with defaults on first access', async () => {
      prismaMock.registrationSetting.upsert.mockResolvedValue({
        tenantId: 't1',
        branchId: 'b1',
      });

      const result = await service.getForBranch('t1', 'b1');

      expect(branchServiceMock.findById).toHaveBeenCalledWith('b1', 't1');
      expect(prismaMock.registrationSetting.upsert).toHaveBeenCalledWith({
        where: { tenantId_branchId: { tenantId: 't1', branchId: 'b1' } },
        create: { tenantId: 't1', branchId: 'b1' },
        update: {},
      });
      expect(result).toEqual({ tenantId: 't1', branchId: 'b1' });
    });
  });

  describe('saveForBranch', () => {
    it('upserts only the provided fields (partial patch)', async () => {
      prismaMock.registrationSetting.findUnique.mockResolvedValue(null);
      prismaMock.registrationSetting.upsert.mockResolvedValue({
        tenantId: 't1',
        branchId: 'b1',
        General_DefaultPaymentMode: 'UPI',
      });

      const dto = { General_DefaultPaymentMode: 'UPI' as const };
      const result = await service.saveForBranch('t1', 'b1', dto);

      expect(prismaMock.registrationSetting.upsert).toHaveBeenCalledWith({
        where: { tenantId_branchId: { tenantId: 't1', branchId: 'b1' } },
        create: { tenantId: 't1', branchId: 'b1', ...dto },
        update: { ...dto },
      });
      expect(result.General_DefaultPaymentMode).toBe('UPI');
    });

    it('rejects a minimum discount percent above the maximum in the same payload', async () => {
      prismaMock.registrationSetting.findUnique.mockResolvedValue(null);

      await expect(
        service.saveForBranch('t1', 'b1', {
          ChargesAndDeductions_MinimumDiscountPercent: 80,
          ChargesAndDeductions_MaximumDiscountPercent: 20,
        }),
      ).rejects.toThrow(ValidationException);
      expect(prismaMock.registrationSetting.upsert).not.toHaveBeenCalled();
    });

    it('rejects raising the minimum above an already-saved maximum', async () => {
      prismaMock.registrationSetting.findUnique.mockResolvedValue({
        ChargesAndDeductions_MinimumTdsPercent: 5,
        ChargesAndDeductions_MaximumTdsPercent: 10,
      });

      await expect(
        service.saveForBranch('t1', 'b1', {
          ChargesAndDeductions_MinimumTdsPercent: 15,
        }),
      ).rejects.toThrow(ValidationException);
    });

    it('allows more than one discount mode as long as at most one is true', async () => {
      prismaMock.registrationSetting.findUnique.mockResolvedValue({
        ChargesAndDeductions_AllowOrderDiscountOnly: true,
        ChargesAndDeductions_AllowLineDiscountOnly: false,
      });
      prismaMock.registrationSetting.upsert.mockResolvedValue({});

      await expect(
        service.saveForBranch('t1', 'b1', {
          ChargesAndDeductions_AllowLineDiscountOnly: false,
        }),
      ).resolves.toBeDefined();
    });

    it('rejects enabling a second mutually-exclusive discount mode', async () => {
      prismaMock.registrationSetting.findUnique.mockResolvedValue({
        ChargesAndDeductions_AllowOrderDiscountOnly: true,
      });

      await expect(
        service.saveForBranch('t1', 'b1', {
          ChargesAndDeductions_AllowLineDiscountOnly: true,
        }),
      ).rejects.toThrow(ConflictingDiscountModeException);
      expect(prismaMock.registrationSetting.upsert).not.toHaveBeenCalled();
    });

    it('rejects all three discount modes enabled at once in a single payload', async () => {
      prismaMock.registrationSetting.findUnique.mockResolvedValue(null);

      await expect(
        service.saveForBranch('t1', 'b1', {
          ChargesAndDeductions_AllowOrderDiscountOnly: true,
          ChargesAndDeductions_AllowLineDiscountOnly: true,
          ChargesAndDeductions_AllowBothOrderAndLineDiscount: true,
        }),
      ).rejects.toThrow(ConflictingDiscountModeException);
    });
  });

  describe('getEnums', () => {
    it('returns the enum lists consumed by the frontend selects', () => {
      const enums = service.getEnums();

      expect(enums).toHaveProperty('defaultPaymentModes');
      expect(enums).toHaveProperty('quotationValidityUnits');
    });
  });
});
