import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BillingInvoiceResetCycle,
  BillingSetting,
  GstMode,
  RefundApprovalLevel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveBillingSettingsDto } from './dto/save-billing-settings.dto';

export interface BillingSettingsEnums {
  invoiceResetCycles: BillingInvoiceResetCycle[];
  gstModes: GstMode[];
  refundApprovalLevels: RefundApprovalLevel[];
}

/**
 * Tenant-level billing settings for Registration. The row is created on first
 * access so the frontend always receives a complete settings object.
 */
@Injectable()
export class BillingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the current tenant's settings, creating defaults if missing. */
  async getSettings(tenantId: string): Promise<BillingSetting> {
    return this.prisma.billingSetting.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  /** Save a partial/full settings payload with upsert semantics. */
  async saveSettings(
    tenantId: string,
    dto: SaveBillingSettingsDto,
  ): Promise<BillingSetting> {
    const existing = await this.prisma.billingSetting.findUnique({
      where: { tenantId },
    });
    const counterMax = dto.counterDiscountMax ?? existing?.counterDiscountMax;
    const managerMax = dto.managerDiscountMax ?? existing?.managerDiscountMax;
    if (
      counterMax !== undefined &&
      managerMax !== undefined &&
      counterMax > managerMax
    ) {
      throw new BadRequestException(
        'counterDiscountMax cannot exceed managerDiscountMax',
      );
    }

    return this.prisma.billingSetting.upsert({
      where: { tenantId },
      create: { tenantId, ...dto },
      update: { ...dto },
    });
  }

  /** Enum values exposed for frontend select controls. */
  getEnums(): BillingSettingsEnums {
    return {
      invoiceResetCycles: Object.values(BillingInvoiceResetCycle),
      gstModes: Object.values(GstMode),
      refundApprovalLevels: Object.values(RefundApprovalLevel),
    };
  }
}
