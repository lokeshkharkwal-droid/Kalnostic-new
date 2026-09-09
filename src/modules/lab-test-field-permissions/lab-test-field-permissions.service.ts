import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_LAB_TEST_FIELD_PERMISSIONS,
  LabTestFieldPermissionsMap,
} from './constants/lab-test-field-permissions.default';
import { UpdateLabTestFieldPermissionDto } from './dto/update-lab-test-field-permission.dto';

/**
 * Tenant-wide Allow/Deny map for Lab Test Master Data fields
 * ("Business Settings › Lab Test Master Setting"). Single source of truth
 * consumed by the Customize Fields sidebar, the Master Data listing columns,
 * and the Add/Edit Test form on the frontend. One singleton row per tenant
 * (`LabTestFieldPermissionSetting`, unique on `tenantId`); every
 * section/field defaults to Allowed (`true`) until explicitly denied.
 */
@Injectable()
export class LabTestFieldPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the tenant's effective field permissions: the stored overrides
   * merged over {@link DEFAULT_LAB_TEST_FIELD_PERMISSIONS} so every known
   * section/field is always present (never throws for a missing row).
   * @param tenantId tenant scope
   */
  async getForTenant(tenantId: string): Promise<LabTestFieldPermissionsMap> {
    const row = await this.prisma.labTestFieldPermissionSetting.findUnique({
      where: { tenantId },
    });
    return this.merge(row?.config);
  }

  /**
   * Merge the given partial config into the tenant's stored permissions and
   * persist it, then return the effective (fully-merged) map.
   * @param tenantId tenant scope
   * @param dto the sections/fields being changed
   */
  async saveForTenant(
    tenantId: string,
    dto: UpdateLabTestFieldPermissionDto,
  ): Promise<LabTestFieldPermissionsMap> {
    const existing = await this.prisma.labTestFieldPermissionSetting.findUnique(
      {
        where: { tenantId },
      },
    );
    const merged = this.merge(existing?.config, dto.config);
    const config = merged as Prisma.InputJsonValue;
    await this.prisma.labTestFieldPermissionSetting.upsert({
      where: { tenantId },
      create: { tenantId, config },
      update: { config },
    });
    return merged;
  }

  /**
   * Merge stored JSON (and an optional incoming patch) over the default
   * registry. Unknown sections/fields and non-boolean leaves are dropped —
   * only booleans for known {@link DEFAULT_LAB_TEST_FIELD_PERMISSIONS}
   * section/field pairs survive, so the result always matches the current
   * registry shape exactly.
   */
  private merge(
    stored?: Prisma.JsonValue | null,
    patch?: Record<string, Record<string, boolean>>,
  ): LabTestFieldPermissionsMap {
    const storedMap = this.asPartialMap(stored);
    const result: LabTestFieldPermissionsMap = {};
    for (const [section, fields] of Object.entries(
      DEFAULT_LAB_TEST_FIELD_PERMISSIONS,
    )) {
      result[section] = { ...fields };
      for (const field of Object.keys(fields)) {
        const storedValue = storedMap?.[section]?.[field];
        if (typeof storedValue === 'boolean')
          result[section][field] = storedValue;
        const patchValue = patch?.[section]?.[field];
        if (typeof patchValue === 'boolean')
          result[section][field] = patchValue;
      }
    }
    return result;
  }

  private asPartialMap(
    value?: Prisma.JsonValue | null,
  ): Record<string, Record<string, boolean>> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    return value as Record<string, Record<string, boolean>>;
  }
}
