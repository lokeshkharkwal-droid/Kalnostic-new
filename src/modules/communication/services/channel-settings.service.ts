import { Injectable } from '@nestjs/common';
import { ChannelOverrideStatus, MessagingChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateChannelSettingsDto } from '../dto/update-channel-settings.dto';
import { UpsertChannelOverrideDto } from '../dto/upsert-channel-override.dto';

/** One per-(feature, channel) override, as returned by the settings endpoints. */
export interface ChannelOverrideView {
  feature: string;
  channel: MessagingChannel;
  status: ChannelOverrideStatus;
}

/** A business's messaging channel capability + overrides for the active scope. */
export interface ChannelSettingsView {
  branchId: string | null;
  isEmailChannelEnabled: boolean;
  isSmsChannelEnabled: boolean;
  isWhatsappChannelEnabled: boolean;
  overrides: ChannelOverrideView[];
}

/**
 * CRUD for a business's messaging channel capability (`BusinessChannelSetting`)
 * and per-feature overrides (`BusinessChannelOverride`) — the configuration the
 * {@link NotificationEnablementService} reads to gate automatic notifications.
 * Scope is `branchId`: null = the tenant-level default; a branch value = that
 * branch's override of it. Absence of a settings row means every channel is
 * enabled (the resolver's backward-compatible default), so reads synthesise
 * defaults rather than forcing a row to exist.
 */
@Injectable()
export class ChannelSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The capability flags + override rows for the caller's scope. */
  async getSettings(
    tenantId: string,
    branchId: string | null,
  ): Promise<ChannelSettingsView> {
    const [setting, overrides] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.businessChannelSetting.findFirst({
          where: { tenantId, branchId, deletedAt: null },
        }),
        tx.businessChannelOverride.findMany({
          where: { tenantId, branchId, deletedAt: null },
          orderBy: [{ feature: 'asc' }, { channel: 'asc' }],
        }),
      ]),
    );
    return {
      branchId,
      isEmailChannelEnabled: setting?.isEmailChannelEnabled ?? true,
      isSmsChannelEnabled: setting?.isSmsChannelEnabled ?? true,
      isWhatsappChannelEnabled: setting?.isWhatsappChannelEnabled ?? true,
      overrides: overrides.map((o) => ({
        feature: o.feature,
        channel: o.channel,
        status: o.status,
      })),
    };
  }

  /**
   * Partial update of the scope's capability flags. Creates the settings row with
   * defaults on first write (there is no `@unique` for a partial-index scope, so
   * this is a scoped find-then-create/update rather than a Prisma upsert).
   */
  async updateSettings(
    tenantId: string,
    branchId: string | null,
    dto: UpdateChannelSettingsDto,
    actorId?: string,
  ): Promise<ChannelSettingsView> {
    const changes = {
      ...(dto.isEmailChannelEnabled !== undefined && {
        isEmailChannelEnabled: dto.isEmailChannelEnabled,
      }),
      ...(dto.isSmsChannelEnabled !== undefined && {
        isSmsChannelEnabled: dto.isSmsChannelEnabled,
      }),
      ...(dto.isWhatsappChannelEnabled !== undefined && {
        isWhatsappChannelEnabled: dto.isWhatsappChannelEnabled,
      }),
    };
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.businessChannelSetting.findFirst({
        where: { tenantId, branchId, deletedAt: null },
      });
      if (existing) {
        await tx.businessChannelSetting.update({
          where: { id: existing.id },
          data: { ...changes, updatedBy: actorId ?? null },
        });
      } else {
        await tx.businessChannelSetting.create({
          data: {
            tenantId,
            branchId,
            ...changes,
            createdBy: actorId ?? null,
            updatedBy: actorId ?? null,
          },
        });
      }
    });
    return this.getSettings(tenantId, branchId);
  }

  /**
   * Upsert one per-(feature, channel) override for the scope. Updates the active
   * row when one exists, else creates it.
   */
  async upsertOverride(
    tenantId: string,
    branchId: string | null,
    dto: UpsertChannelOverrideDto,
    actorId?: string,
  ): Promise<ChannelSettingsView> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.businessChannelOverride.findFirst({
        where: {
          tenantId,
          branchId,
          feature: dto.feature,
          channel: dto.channel,
          deletedAt: null,
        },
      });
      if (existing) {
        await tx.businessChannelOverride.update({
          where: { id: existing.id },
          data: { status: dto.status, updatedBy: actorId ?? null },
        });
      } else {
        await tx.businessChannelOverride.create({
          data: {
            tenantId,
            branchId,
            feature: dto.feature,
            channel: dto.channel,
            status: dto.status,
            createdBy: actorId ?? null,
            updatedBy: actorId ?? null,
          },
        });
      }
    });
    return this.getSettings(tenantId, branchId);
  }
}
