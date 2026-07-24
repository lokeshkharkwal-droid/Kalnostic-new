import { Injectable } from '@nestjs/common';
import { Prisma, SalesSetting } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSalesSettingsDto } from './dto/update-sales-settings.dto';

/**
 * Tenant-level sales settings (one row per tenant, keyed on the unique
 * `tenantId`). There is exactly one settings blob per business, so there is no
 * branch scope here — the `config` JSON holds the module's configuration
 * sections. The row is created lazily on first read (upsert-on-read).
 */
@Injectable()
export class SalesSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch the tenant's sales settings, creating an empty row on first access so
   * callers always get a settings object back.
   * @param tenantId tenant scope
   * @returns the tenant's `SalesSetting` row
   */
  async get(tenantId: string): Promise<SalesSetting> {
    const existing = await this.prisma.salesSetting.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.salesSetting.create({ data: { tenantId, config: {} } }),
    );
  }

  /**
   * Update the tenant's sales settings by shallow-merging the supplied `config`
   * over the existing stored config. Creates the row if it does not yet exist.
   * @param tenantId tenant scope
   * @param dto the settings `config` to merge
   * @returns the updated `SalesSetting` row
   */
  async update(
    tenantId: string,
    dto: UpdateSalesSettingsDto,
  ): Promise<SalesSetting> {
    const current = await this.get(tenantId);
    const currentConfig =
      current.config && typeof current.config === 'object'
        ? (current.config as Record<string, unknown>)
        : {};
    const merged = {
      ...currentConfig,
      ...dto.config,
    } as Prisma.InputJsonObject;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.salesSetting.update({
        where: { tenantId },
        data: { config: merged },
      }),
    );
  }
}
