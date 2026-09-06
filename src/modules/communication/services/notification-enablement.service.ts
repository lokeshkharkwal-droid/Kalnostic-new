import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelOverrideStatus,
  MessagingChannel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * The per-patient notification opt-out payload stored on `Patient.notificationOptOut`
 * (ports the legacy `PatientPreferences.dont_send`). `channels` suppress a channel
 * for every feature; `features[key]` suppress it only for that FEATURE_TYPES key.
 */
export interface PatientNotificationOptOut {
  channels?: MessagingChannel[];
  features?: Record<string, MessagingChannel[]>;
}

/**
 * Resolves which delivery channels a given automatic notification should actually
 * be sent over — the fan-out enablement gate the legacy PHP
 * `getEnabledMessagingPreferences` performed. Given the caller's requested channels
 * it drops, in order: (1) channels the business has marked incapable
 * (`BusinessChannelSetting`), (2) channels a business override suppresses for the
 * feature (`BusinessChannelOverride.status = DONT_SEND`), and (3) channels the
 * patient has opted out of (`Patient.notificationOptOut`).
 *
 * **Backward-compatible by construction:** every gate keeps a channel unless a row
 * explicitly drops it, so with no settings/overrides/opt-out configured this
 * returns `requestedChannels` unchanged — exactly today's behaviour. All reads run
 * inside `withTenant` so out-of-request callers (event listeners, crons) satisfy
 * RLS. Any failure is swallowed and the requested channels are returned unchanged,
 * so a gating error never silently suppresses a notification.
 */
@Injectable()
export class NotificationEnablementService {
  private readonly logger = new Logger(NotificationEnablementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Filter `requestedChannels` down to the channels that pass the business
   * capability, business override, and patient opt-out gates.
   *
   * @param tenantId owning tenant (RLS)
   * @param branchId active branch, or null for a tenant-level send
   * @param feature the FEATURE_TYPES key being dispatched
   * @param requestedChannels the channels the caller intends to send over
   * @param patientId the patient recipient's id, or null for non-patient recipients
   *   (the opt-out gate only applies to patients, mirroring the legacy behaviour)
   * @returns the subset of `requestedChannels` that survive all gates
   */
  async resolveEnabledChannels(
    tenantId: string,
    branchId: string | null,
    feature: string,
    requestedChannels: MessagingChannel[],
    patientId?: string | null,
  ): Promise<MessagingChannel[]> {
    if (requestedChannels.length === 0) return requestedChannels;
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const capability = await this.loadCapability(tx, tenantId, branchId);
        const suppressed = await this.loadSuppressedChannels(
          tx,
          tenantId,
          branchId,
          feature,
        );
        const optedOut = patientId
          ? await this.loadPatientOptOut(tx, tenantId, patientId, feature)
          : new Set<MessagingChannel>();

        return requestedChannels.filter(
          (channel) =>
            this.isChannelCapable(capability, channel) &&
            !suppressed.has(channel) &&
            !optedOut.has(channel),
        );
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Channel enablement resolution failed for feature "${feature}" (tenant ${tenantId}); sending over requested channels. ${message}`,
      );
      return requestedChannels;
    }
  }

  /**
   * The business's channel capability for the active scope: the branch-level row
   * when a branch is set and one exists, else the tenant-level default. Null when
   * the business has configured nothing (→ every channel capable).
   */
  private async loadCapability(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
  ): Promise<{
    isEmailChannelEnabled: boolean;
    isSmsChannelEnabled: boolean;
    isWhatsappChannelEnabled: boolean;
  } | null> {
    if (branchId) {
      const branchRow = await tx.businessChannelSetting.findFirst({
        where: { tenantId, branchId, deletedAt: null },
      });
      if (branchRow) return branchRow;
    }
    return tx.businessChannelSetting.findFirst({
      where: { tenantId, branchId: null, deletedAt: null },
    });
  }

  /** Whether the business permits a channel (absent capability row = capable). */
  private isChannelCapable(
    capability: {
      isEmailChannelEnabled: boolean;
      isSmsChannelEnabled: boolean;
      isWhatsappChannelEnabled: boolean;
    } | null,
    channel: MessagingChannel,
  ): boolean {
    if (!capability) return true;
    switch (channel) {
      case MessagingChannel.EMAIL:
        return capability.isEmailChannelEnabled;
      case MessagingChannel.SMS:
        return capability.isSmsChannelEnabled;
      case MessagingChannel.WHATSAPP:
        return capability.isWhatsappChannelEnabled;
      default:
        return true; // non-deliverable channels aren't gated by capability
    }
  }

  /**
   * The set of channels a business override suppresses (`DONT_SEND`) for this
   * feature. A branch-level override wins over a tenant-level one for the same
   * channel; absence of a row = inherit (not suppressed).
   */
  private async loadSuppressedChannels(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    feature: string,
  ): Promise<Set<MessagingChannel>> {
    const rows = await tx.businessChannelOverride.findMany({
      where: {
        tenantId,
        feature,
        deletedAt: null,
        // Branch-level rows (the given branch) plus the tenant-level default rows
        // (branchId null); when no branch is active only the tenant-level rows.
        ...(branchId
          ? { OR: [{ branchId }, { branchId: null }] }
          : { branchId: null }),
      },
    });
    // Branch-level rows are more specific than tenant-level (branchId null): let a
    // branch row's status override the tenant default for the same channel.
    const status = new Map<MessagingChannel, ChannelOverrideStatus>();
    for (const row of rows) {
      const existingIsBranch = status.has(row.channel);
      if (!existingIsBranch || row.branchId !== null) {
        status.set(row.channel, row.status);
      }
    }
    const suppressed = new Set<MessagingChannel>();
    for (const [channel, s] of status) {
      if (s === ChannelOverrideStatus.DONT_SEND) suppressed.add(channel);
    }
    return suppressed;
  }

  /**
   * The set of channels the patient has opted out of for this feature — the union
   * of the global `channels` list and the per-feature `features[feature]` list.
   */
  private async loadPatientOptOut(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    feature: string,
  ): Promise<Set<MessagingChannel>> {
    const patient = await tx.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: { notificationOptOut: true },
    });
    return this.parseOptOut(patient?.notificationOptOut ?? null, feature);
  }

  /** Defensively parse the opt-out JSON into the suppressed-channel set. */
  private parseOptOut(
    raw: Prisma.JsonValue | null,
    feature: string,
  ): Set<MessagingChannel> {
    const out = new Set<MessagingChannel>();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const optOut = raw as PatientNotificationOptOut;
    this.collectChannels(optOut.channels, out);
    this.collectChannels(optOut.features?.[feature], out);
    return out;
  }

  /** Add valid MessagingChannel values from a candidate list into `into`. */
  private collectChannels(
    candidates: unknown,
    into: Set<MessagingChannel>,
  ): void {
    if (!Array.isArray(candidates)) return;
    for (const c of candidates) {
      if (
        typeof c === 'string' &&
        (Object.values(MessagingChannel) as string[]).includes(c)
      ) {
        into.add(c as MessagingChannel);
      }
    }
  }
}
