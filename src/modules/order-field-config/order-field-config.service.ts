import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { SaveOrderFieldConfigDto } from './dto/save-order-field-config.dto';
import {
  OrderFieldConfigEntity,
  OrderFieldConfigMap,
} from './entities/order-field-config.entity';

/**
 * Per-branch Create-Order field configuration. Tenant-scoped **and**
 * branch-level (CLAUDE.md §4.7): every query carries `tenantId` + `branchId`
 * and filters soft-deleted rows. There is exactly one config per branch
 * (unique `(tenantId, branchId)`); saving upserts it. The `config` payload is
 * the `{ section: { field: boolean } }` visibility map the frontend manages.
 */
@Injectable()
export class OrderFieldConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Fetch the active branch's field configuration.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; validated against the tenant)
   * @returns the saved config, or `null` when the branch has none yet
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<OrderFieldConfigEntity | null> {
    // Validates the branch belongs to the caller's tenant (throws otherwise).
    await this.branchService.findById(branchId, tenantId);

    const row = await this.prisma.orderFieldConfig.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    return row ? this.toEntity(row) : null;
  }

  /**
   * Create or replace the active branch's field configuration.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; validated against the tenant)
   * @param dto the full field-visibility map to persist
   * @returns the saved config
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SaveOrderFieldConfigDto,
  ): Promise<OrderFieldConfigEntity> {
    // Validates the branch belongs to the caller's tenant (throws otherwise).
    await this.branchService.findById(branchId, tenantId);

    const config = dto.config as Prisma.InputJsonValue;
    const row = await this.prisma.orderFieldConfig.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, config },
      update: { config, deletedAt: null },
    });
    return this.toEntity(row);
  }

  /** Narrow the persisted JSON to the domain config map. */
  private toEntity(
    row: {
      config: Prisma.JsonValue;
    } & Record<string, unknown>,
  ): OrderFieldConfigEntity {
    return {
      ...(row as unknown as OrderFieldConfigEntity),
      config: (row.config ?? {}) as OrderFieldConfigMap,
    };
  }
}
