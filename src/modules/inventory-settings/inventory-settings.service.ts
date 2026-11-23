import { Injectable } from '@nestjs/common';
import { InventoryManualAdjustmentMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveInventorySettingsDto } from './dto/save-inventory-settings.dto';
import { InventorySettings } from './entities/inventory-settings.entity';

/** The columns that make up the public Inventory Settings shape. */
const SELECT = {
  isAutomaticInventoryReductionEnabled: true,
  manualAdjustmentMode: true,
} as const;

/**
 * Tenant-level Inventory Settings (Business Admin › Business Settings): whether
 * inventory is auto-deducted at order creation and where manual inventory
 * adjustment is offered in Technician Reporting. One row per tenant (unique
 * `tenantId`), created on first read so callers always receive a complete object.
 * Mirrors `QrCodeScanSettingsService` for its upsert-on-read pattern, but
 * tenant-level (no branch).
 */
@Injectable()
export class InventorySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch the tenant's Inventory Settings, creating the default row on first
   * access (auto reduction OFF; manual adjustment ORDER_TYPE).
   * @param tenantId the current tenant from the token
   * @returns the tenant's current inventory settings
   */
  async get(tenantId: string): Promise<InventorySettings> {
    return this.prisma.inventorySetting.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: SELECT,
    });
  }

  /**
   * Save (partial patch, upsert) the tenant's Inventory Settings. A field left
   * out of `dto` keeps its current value.
   * @param tenantId the current tenant from the token
   * @param dto the fields to change
   * @returns the saved inventory settings
   */
  async save(
    tenantId: string,
    dto: SaveInventorySettingsDto,
  ): Promise<InventorySettings> {
    const patch: {
      isAutomaticInventoryReductionEnabled?: boolean;
      manualAdjustmentMode?: InventoryManualAdjustmentMode;
    } = {};
    if (dto.isAutomaticInventoryReductionEnabled !== undefined) {
      patch.isAutomaticInventoryReductionEnabled =
        dto.isAutomaticInventoryReductionEnabled;
    }
    if (dto.manualAdjustmentMode !== undefined) {
      patch.manualAdjustmentMode = dto.manualAdjustmentMode;
    }

    return this.prisma.inventorySetting.upsert({
      where: { tenantId },
      create: { tenantId, ...patch },
      update: patch,
      select: SELECT,
    });
  }

  /**
   * Lean read used by the order-creation flow to decide whether to auto-deduct
   * inventory and, if so, at what granularity. Does not create a row (returns
   * the defaults when none exists yet, so the common "never configured" case
   * means auto-reduction OFF).
   * @param tenantId the current tenant from the token
   * @returns the tenant's effective inventory settings
   */
  async getForTenant(tenantId: string): Promise<InventorySettings> {
    const row = await this.prisma.inventorySetting.findUnique({
      where: { tenantId },
      select: SELECT,
    });
    return (
      row ?? {
        isAutomaticInventoryReductionEnabled: false,
        manualAdjustmentMode: InventoryManualAdjustmentMode.ORDER_TYPE,
      }
    );
  }
}
