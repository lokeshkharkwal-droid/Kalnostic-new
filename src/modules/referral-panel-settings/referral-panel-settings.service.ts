import { Injectable } from '@nestjs/common';
import { Prisma, ReferralBonusType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateReferralPanelSettingsDto } from './dto/create-referral-panel-settings.dto';
import { UpdateReferralPanelSettingsDto } from './dto/update-referral-panel-settings.dto';
import { ListReferralPanelSettingsDto } from './dto/list-referral-panel-settings.dto';
import { ReferralPanelSettingsEntity } from './entities/referral-panel-settings.entity';
import {
  InvalidReferralPanelSettingsBonusException,
  ReferralPanelSettingsDefaultConflictException,
  ReferralPanelSettingsNameConflictException,
  ReferralPanelSettingsNotFoundException,
} from './exceptions/referral-panel-settings.exceptions';

/**
 * Referral panel settings management. Tenant-scoped, tenant-level (CLAUDE.md §4.6):
 * every query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. `branchId` is carried on the model for future use but reads are
 * scoped by tenant only. At most one default template per `clientType` is enforced
 * here (the prior default is cleared in the same transaction) and backed by a partial
 * unique index in `prisma/rls.sql`. The DTO field names map 1:1 to the model's scalar
 * columns, so writes spread the DTO directly.
 */
@Injectable()
export class ReferralPanelSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a referral panel settings template. If `isDefault` is set, the existing
   * default for the same `clientType` is cleared first (one default per client type).
   * @param tenantId owning tenant (from JWT)
   * @param dto validated payload (no `tenantId`/`branchId` — set from context)
   * @param actorId person id of the creator (optional audit trail)
   * @returns the created settings template
   * @throws InvalidReferralPanelSettingsBonusException on a bonus invariant
   * @throws ReferralPanelSettingsNameConflictException / …DefaultConflictException
   */
  async create(
    tenantId: string,
    dto: CreateReferralPanelSettingsDto,
    actorId?: string,
  ): Promise<ReferralPanelSettingsEntity> {
    this.assertBonus(dto.bonusType, dto.bonusPercentage, dto.bonusFixedAmount);

    const isDefault = dto.isDefault ?? false;
    const data: Prisma.ReferralPanelSettingsUncheckedCreateInput = {
      ...dto,
      tenantId,
      isDefault,
      createdBy: actorId ?? null,
      updatedBy: actorId ?? null,
    };

    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        if (isDefault) {
          await tx.referralPanelSettings.updateMany({
            where: {
              tenantId,
              clientType: dto.clientType,
              isDefault: true,
              deletedAt: null,
            },
            data: { isDefault: false },
          });
        }
        const created = await tx.referralPanelSettings.create({ data });
        return created.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.settingName, dto.clientType);
      throw e;
    }
    return this.findById(createdId, tenantId);
  }

  /**
   * Fetch one active settings template scoped to its tenant.
   * @param id settings id
   * @param tenantId tenant scope
   * @throws ReferralPanelSettingsNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<ReferralPanelSettingsEntity> {
    const settings = await this.prisma.referralPanelSettings.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!settings) {
      throw new ReferralPanelSettingsNotFoundException(id);
    }
    return settings;
  }

  /**
   * List active settings templates for a tenant (offset pagination). Optional
   * `clientType` / `status` filters and a case-insensitive `search` on the setting
   * name. Scoped by tenant only (not branch).
   * @param tenantId tenant scope
   * @param query pagination + optional filters
   */
  async findAll(
    tenantId: string,
    query: ListReferralPanelSettingsDto,
  ): Promise<PaginatedResult<ReferralPanelSettingsEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ReferralPanelSettingsWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.clientType) where.clientType = query.clientType;
    if (query.status) where.status = query.status;
    if (query.search) {
      const search = query.search.trim();
      if (search) {
        where.settingName = { contains: search, mode: 'insensitive' };
      }
    }
    const [data, total] = await Promise.all([
      this.prisma.referralPanelSettings.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referralPanelSettings.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Update a settings template. Re-validates the bonus config when `bonusType` is
   * touched, and re-applies the one-default-per-client-type rule (clearing the prior
   * default) whenever the result would be a default for its client type.
   * @param id settings id
   * @param tenantId tenant scope
   * @param dto partial update
   * @param actorId person id of the editor (optional audit trail)
   * @throws ReferralPanelSettingsNotFoundException / InvalidReferralPanelSettingsBonusException /
   *   ReferralPanelSettingsNameConflictException / ReferralPanelSettingsDefaultConflictException
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateReferralPanelSettingsDto,
    actorId?: string,
  ): Promise<ReferralPanelSettingsEntity> {
    const existing = await this.findById(id, tenantId);

    if (dto.bonusType !== undefined) {
      this.assertBonus(
        dto.bonusType,
        dto.bonusPercentage ?? this.decToNum(existing.bonusPercentage),
        dto.bonusFixedAmount ?? this.decToNum(existing.bonusFixedAmount),
      );
    }

    const effectiveClientType = dto.clientType ?? existing.clientType;
    const effectiveIsDefault = dto.isDefault ?? existing.isDefault;

    const data: Prisma.ReferralPanelSettingsUpdateInput = { ...dto };
    if (actorId !== undefined) {
      data.updatedBy = actorId;
    }

    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        if (effectiveIsDefault) {
          await tx.referralPanelSettings.updateMany({
            where: {
              tenantId,
              clientType: effectiveClientType,
              isDefault: true,
              deletedAt: null,
              id: { not: id },
            },
            data: { isDefault: false },
          });
        }
        await tx.referralPanelSettings.update({ where: { id }, data });
      });
    } catch (e) {
      this.rethrowConflict(
        e,
        dto.settingName ?? existing.settingName,
        effectiveClientType,
      );
      throw e;
    }
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete a settings template (sets deletedAt; row is preserved). Referral
   * entities keep their `referralPanelSettingsId` value but it no longer resolves.
   * @param id settings id
   * @param tenantId tenant scope
   * @throws ReferralPanelSettingsNotFoundException if missing/soft-deleted
   */
  async remove(
    id: string,
    tenantId: string,
  ): Promise<ReferralPanelSettingsEntity> {
    await this.findById(id, tenantId);
    return this.prisma.referralPanelSettings.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Validate the prepaid bonus configuration: a chosen `bonusType` requires its
   * matching amount (a percentage for PERCENTAGE, a fixed amount for FIXED_AMOUNT).
   * @param bonusType the chosen bonus type (or null/undefined when not set)
   * @param bonusPercentage the percentage value (or null)
   * @param bonusFixedAmount the fixed amount value (or null)
   * @throws InvalidReferralPanelSettingsBonusException on a violation
   */
  private assertBonus(
    bonusType: ReferralBonusType | null | undefined,
    bonusPercentage: number | null | undefined,
    bonusFixedAmount: number | null | undefined,
  ): void {
    if (
      bonusType === ReferralBonusType.PERCENTAGE &&
      (bonusPercentage === null || bonusPercentage === undefined)
    ) {
      throw new InvalidReferralPanelSettingsBonusException(
        'bonusPercentage is required when bonusType is PERCENTAGE',
      );
    }
    if (
      bonusType === ReferralBonusType.FIXED_AMOUNT &&
      (bonusFixedAmount === null || bonusFixedAmount === undefined)
    ) {
      throw new InvalidReferralPanelSettingsBonusException(
        'bonusFixedAmount is required when bonusType is FIXED_AMOUNT',
      );
    }
  }

  /**
   * Coerce a nullable Prisma Decimal column to a plain number (or null).
   * @param d the Decimal value (or null)
   */
  private decToNum(d: Prisma.Decimal | null): number | null {
    return d === null ? null : d.toNumber();
  }

  /**
   * Map a caught error to the right 409 when it is a unique-constraint violation
   * (P2002): the partial default index → default conflict, otherwise the name index
   * → name conflict. Returns silently for any other error so the caller can rethrow
   * it unchanged.
   * @param e the caught error
   * @param settingName the setting name (for the name-conflict message)
   * @param clientType the client type (for the default-conflict message)
   */
  private rethrowConflict(
    e: unknown,
    settingName: string,
    clientType: string,
  ): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const rawTarget: unknown = e.meta?.target;
      let targetStr = '';
      if (Array.isArray(rawTarget)) {
        targetStr = (rawTarget as unknown[])
          .map((x) => (typeof x === 'string' ? x : ''))
          .join(',');
      } else if (typeof rawTarget === 'string') {
        targetStr = rawTarget;
      }
      if (targetStr.includes('default')) {
        throw new ReferralPanelSettingsDefaultConflictException(clientType);
      }
      throw new ReferralPanelSettingsNameConflictException(settingName);
    }
  }
}
