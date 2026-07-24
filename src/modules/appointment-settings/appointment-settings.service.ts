import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import {
  AppointmentSettingsMap,
  DEFAULT_APPOINTMENT_SETTINGS,
} from './constants/appointment-settings.default';
import { SaveAppointmentSettingsDto } from './dto/save-appointment-settings.dto';

/**
 * Per-branch appointment settings (Registration › Appointment Settings).
 * Tenant-scoped **and** branch-level (CLAUDE.md §4.7): every query carries
 * `tenantId` + `branchId`. Mirrors `AccessionSettingsService` — one row per
 * branch (unique `(tenantId, branchId)`), the payload held as JSON. A branch
 * with no saved row uses `DEFAULT_APPOINTMENT_SETTINGS`; `resolve` always
 * returns a complete settings map (stored values merged over the defaults).
 */
@Injectable()
export class AppointmentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve the effective settings for a branch: the stored partial merged
   * over the module defaults (never throws for a missing row — returns
   * defaults).
   * @param tenantId tenant scope
   * @param branchId active branch (null falls back to defaults)
   */
  async resolve(
    tenantId: string,
    branchId: string | null,
  ): Promise<AppointmentSettingsMap> {
    if (!branchId) return DEFAULT_APPOINTMENT_SETTINGS;
    const row = await this.prisma.appointmentSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    return this.merge(row?.config);
  }

  /**
   * Fetch the branch's effective settings (validates the branch first).
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<AppointmentSettingsMap> {
    await this.branchService.findById(branchId, tenantId);
    return this.resolve(tenantId, branchId);
  }

  /**
   * Create or update the branch's settings, then return the effective map.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SaveAppointmentSettingsDto,
  ): Promise<AppointmentSettingsMap> {
    await this.branchService.findById(branchId, tenantId);
    const existing = await this.prisma.appointmentSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    const merged = { ...this.merge(existing?.config), ...dto };
    const config = merged as Prisma.InputJsonValue;
    await this.prisma.appointmentSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, config },
      update: { config, deletedAt: null },
    });
    return this.resolve(tenantId, branchId);
  }

  /** Merge a stored partial settings JSON over the module defaults. */
  private merge(stored: Prisma.JsonValue | undefined): AppointmentSettingsMap {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return DEFAULT_APPOINTMENT_SETTINGS;
    }
    const partial = stored as Partial<AppointmentSettingsMap>;
    return {
      slotDurationMinutes:
        partial.slotDurationMinutes ??
        DEFAULT_APPOINTMENT_SETTINGS.slotDurationMinutes,
      bufferMinutes:
        partial.bufferMinutes ?? DEFAULT_APPOINTMENT_SETTINGS.bufferMinutes,
      maxWalkInsPerDay:
        partial.maxWalkInsPerDay ??
        DEFAULT_APPOINTMENT_SETTINGS.maxWalkInsPerDay,
      maxOnlineBookingsPerSlot:
        partial.maxOnlineBookingsPerSlot ??
        DEFAULT_APPOINTMENT_SETTINGS.maxOnlineBookingsPerSlot,
      openTime: partial.openTime ?? DEFAULT_APPOINTMENT_SETTINGS.openTime,
      closeTime: partial.closeTime ?? DEFAULT_APPOINTMENT_SETTINGS.closeTime,
      weeklyOff: partial.weeklyOff ?? DEFAULT_APPOINTMENT_SETTINGS.weeklyOff,
      lunchBreak: partial.lunchBreak ?? DEFAULT_APPOINTMENT_SETTINGS.lunchBreak,
      isSmsReminder24hEnabled:
        partial.isSmsReminder24hEnabled ??
        DEFAULT_APPOINTMENT_SETTINGS.isSmsReminder24hEnabled,
      isWhatsappReminder2hEnabled:
        partial.isWhatsappReminder2hEnabled ??
        DEFAULT_APPOINTMENT_SETTINGS.isWhatsappReminder2hEnabled,
      isEmailConfirmationEnabled:
        partial.isEmailConfirmationEnabled ??
        DEFAULT_APPOINTMENT_SETTINGS.isEmailConfirmationEnabled,
      isVoiceCallForStatEnabled:
        partial.isVoiceCallForStatEnabled ??
        DEFAULT_APPOINTMENT_SETTINGS.isVoiceCallForStatEnabled,
      noShowGraceMinutes:
        partial.noShowGraceMinutes ??
        DEFAULT_APPOINTMENT_SETTINGS.noShowGraceMinutes,
      cancellationCutoffHours:
        partial.cancellationCutoffHours ??
        DEFAULT_APPOINTMENT_SETTINGS.cancellationCutoffHours,
      isAutoCancelAfterGraceEnabled:
        partial.isAutoCancelAfterGraceEnabled ??
        DEFAULT_APPOINTMENT_SETTINGS.isAutoCancelAfterGraceEnabled,
      isNoShowFeeChargeEnabled:
        partial.isNoShowFeeChargeEnabled ??
        DEFAULT_APPOINTMENT_SETTINGS.isNoShowFeeChargeEnabled,
    };
  }
}
