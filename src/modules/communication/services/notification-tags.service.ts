import { Injectable, Logger } from '@nestjs/common';
import { Relationship } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  toNum,
  formatTenantDate,
  formatTenantTime,
  toBranchLocalInstant,
} from '../../../common/utils';
import { TenantTimeZoneService } from '../../tenant/tenant-timezone.service';
import { emptyNotificationTagValues } from '../../template/constants/notification-tags';
import { resolveActorNames } from '../../lab-report/entities/worklist.entity';
import { fullName } from '../../lab-report/entities/lab-report.entity';
import { publicOrderUrl } from '../../lab-report/utils/print-barcode.util';

/**
 * What a send knows about its subject — every field optional except the
 * tenant. The resolver derives everything else (branch, patient, doctor,
 * phlebotomist, amounts, links) from these ids.
 */
export interface NotificationTagContext {
  tenantId: string;
  /** Scope branch; the order's own branch wins when `orderId` is given. */
  branchId?: string | null;
  /** The order the message is about (drives the order/appointment/link tags). */
  orderId?: string | null;
  /** The patient the message is about (defaults to the order's patient). */
  patientId?: string | null;
  /** The staff person who performed the action (`{updated_by}`). */
  actorId?: string | null;
  /**
   * The moment `{date}`/`{time}` describe — the appointment / collection slot
   * for appointment messages. Defaults to "now" (when the event happened).
   */
  at?: Date | string | null;
  /** The recipient's display name (`{patient_name}`). */
  recipientName?: string | null;
  /**
   * The recipient's email (`{email}`). Leave `undefined` when the recipient IS
   * the patient (or unknown) to fall back to the patient's email; pass `null`/a
   * value when the recipient is someone else (panel, doctor, business).
   */
  recipientEmail?: string | null;
}

/** The tags that depend only on the patient (batched for bulk compose). */
export type PatientTagValues = Record<
  'pfn' | 'patient' | 'patient_unique_id' | 'email' | 'condition_name',
  string
>;

interface PatientRow {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  umId: string | null;
  email: string | null;
  mobile: string | null;
  /** The newest active link where this patient is the family MEMBER. */
  familyMemberOf: Array<{
    relationship: Relationship;
    patient: { mobile: string | null };
  }>;
}

interface BranchRow {
  name: string;
  shortName: string;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
}

/** The tenant `settings` JSON keys the tags read. */
interface TenantTagSettings {
  currency?: string;
  date_format?: string;
  time_format?: string;
}

const PATIENT_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  umId: true,
  email: true,
  mobile: true,
  familyMemberOf: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { relationship: true, patient: { select: { mobile: true } } },
  },
} as const;

/**
 * `{condition_name}` — condition-based recipient text, ported from the
 * ezHealthTrack reminder ("…a friendly reminder that {condition_name} have an
 * appointment…"). Patient messages go to the patient's own mobile; a family
 * member usually shares the anchor's (that's why members are exempt from the
 * mobile-unique index), so the anchor reads it → "your son Rahul". A patient
 * with their own number (or not linked as a member) reads it themself → "you".
 * @param p the patient the message is about
 * @returns "you" or "your <relation> <first name>"
 */
function conditionName(p: PatientRow): string {
  const link = p.familyMemberOf[0];
  const ownMobile = (p.mobile ?? '').trim();
  const sharesAnchorPhone =
    !ownMobile || ownMobile === (link?.patient.mobile ?? '').trim();
  if (!link || link.relationship === Relationship.SELF || !sharesAnchorPhone) {
    return 'you';
  }
  const relation =
    link.relationship === Relationship.OTHER
      ? 'family member'
      : link.relationship.toLowerCase();
  return `your ${relation} ${p.firstName}`.trim();
}

const BRANCH_SELECT = {
  name: true,
  shortName: true,
  phone: true,
  addressLine: true,
  city: true,
} as const;

/**
 * Resolves the GLOBAL notification tag catalogue
 * (`template/constants/notification-tags.ts`) for one send. Every send path —
 * `CommunicationService.enqueue` (Email/SMS/WhatsApp: automatic, share and
 * manual compose), `AutoNotificationService` and `ShareService` in-app (IAM) —
 * merges this map under its own event-specific values, so any catalogue tag
 * works in any template. Every catalogue key is always present: data the
 * context has no source for resolves to `''`, so a tag never leaks as literal
 * `{tag}` text (and WhatsApp positional params never shift). Best-effort: a
 * lookup failure is logged and yields the blank baseline rather than blocking
 * the (already-committed) business operation the message is about.
 *
 * Tenant-scoped reads run inside `withTenant` (RLS GUC) so out-of-request
 * callers (event listeners, crons) work; `tenants` and `persons` are
 * platform-level.
 */
@Injectable()
export class NotificationTagsService {
  private readonly logger = new Logger(NotificationTagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantTz: TenantTimeZoneService,
  ) {}

  /**
   * Resolve every catalogue tag for `ctx`.
   * @param ctx what the send knows about its subject
   * @returns `{ tagKey → value }` over the whole catalogue (keys WITHOUT braces)
   */
  async resolve(ctx: NotificationTagContext): Promise<Record<string, string>> {
    const out = emptyNotificationTagValues();
    const recipientName = (ctx.recipientName ?? '').trim();
    out.patient_name = recipientName;
    out.email = ctx.recipientEmail ?? '';
    try {
      await this.fill(out, ctx, recipientName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Tag resolution failed for tenant ${ctx.tenantId}` +
          `${ctx.orderId ? ` order ${ctx.orderId}` : ''}: ${message}`,
      );
    }
    return out;
  }

  /**
   * The patient-only tags for many patients in one query — used by manual
   * compose, where each recipient may be a different patient.
   * @param tenantId tenant scope
   * @param patientIds patient ids (duplicates/empties ignored)
   * @returns patient id → its patient tags (missing patients are absent)
   */
  async resolvePatientTags(
    tenantId: string,
    patientIds: Array<string | null | undefined>,
  ): Promise<Map<string, PatientTagValues>> {
    const ids = [...new Set(patientIds.filter((id): id is string => !!id))];
    const byId = new Map<string, PatientTagValues>();
    if (ids.length === 0) return byId;
    try {
      const rows = await this.prisma.withTenant(tenantId, (tx) =>
        tx.patient.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: PATIENT_SELECT,
        }),
      );
      for (const p of rows) byId.set(p.id, this.patientTags(p, undefined));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Patient tag lookup failed: ${message}`);
    }
    return byId;
  }

  /** Populate `out` from the DB for `ctx` (mutates; may throw). */
  private async fill(
    out: Record<string, string>,
    ctx: NotificationTagContext,
    recipientName: string,
  ): Promise<void> {
    const { tenantId } = ctx;
    const [tenant, zone] = await Promise.all([
      this.prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true, shortName: true, settings: true },
      }),
      this.tenantTz.getTimeZone(tenantId),
    ]);

    const scoped = await this.prisma.withTenant(tenantId, async (tx) => {
      const order = ctx.orderId
        ? await tx.order.findFirst({
            where: { id: ctx.orderId, tenantId },
            select: {
              orderCode: true,
              billId: true,
              branchId: true,
              patientId: true,
              branch: { select: BRANCH_SELECT },
              items: {
                where: { deletedAt: null },
                select: {
                  direct: true,
                  branchLabTest: { select: { testName: true } },
                  branchLabPanel: { select: { panelName: true } },
                },
              },
              payments: {
                where: { deletedAt: null },
                select: {
                  totalAmount: true,
                  netAmount: true,
                  paidAmount: true,
                },
              },
              diagnostics: {
                select: {
                  isHomeVisit: true,
                  collectionAddress: true,
                  phlebotomist: {
                    select: { firstName: true, lastName: true, phone: true },
                  },
                },
              },
              opd: {
                select: {
                  doctor: { select: { firstName: true, lastName: true } },
                },
              },
              referredByDoctor: {
                select: {
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  hospitalName: true,
                },
              },
            },
          })
        : null;
      const branchId = order?.branchId ?? ctx.branchId ?? null;
      const branch: BranchRow | null =
        order?.branch ??
        (branchId
          ? await tx.branch.findFirst({
              where: { id: branchId, tenantId },
              select: BRANCH_SELECT,
            })
          : null);
      const patientId = ctx.patientId ?? order?.patientId ?? null;
      const patient: PatientRow | null = patientId
        ? await tx.patient.findFirst({
            where: { id: patientId, tenantId },
            select: PATIENT_SELECT,
          })
        : null;
      return { order, branch, branchId, patient };
    });
    const { order, branch, branchId, patient } = scoped;

    const actorName = ctx.actorId
      ? ((await resolveActorNames(this.prisma, [ctx.actorId])).get(
          ctx.actorId,
        ) ?? '')
      : '';

    // ── Business & branch ──
    const settings = (tenant?.settings ?? {}) as TenantTagSettings;
    const businessName = tenant?.name ?? '';
    const businessShort = tenant?.shortName || businessName;
    out.web_title = businessName;
    out.business_short_name = businessShort;
    out.user_name = branch?.name || businessName;
    out.lab = out.user_name;
    out.branch_short_name = branch?.shortName || tenant?.shortName || '';
    out.branch_phone_number = branch?.phone ?? '';
    out.currency = settings.currency ?? 'INR';

    // ── Date / time (event moment, or the appointment slot via `at`) ──
    const at = ctx.at ? new Date(ctx.at) : new Date();
    const local = toBranchLocalInstant(
      Number.isNaN(at.getTime()) ? new Date() : at,
      zone,
    );
    out.date = formatTenantDate(local, settings.date_format ?? 'DD/MM/YYYY');
    out.time = formatTenantTime(local, settings.time_format ?? '12h');

    // ── Patient ──
    if (patient) {
      Object.assign(out, this.patientTags(patient, ctx.recipientEmail));
    } else {
      out.pfn = recipientName;
      out.patient = recipientName;
    }
    if (!out.patient_name) {
      out.patient_name = out.pfn ?? '';
    }

    // ── Staff ──
    out.updated_by = actorName;

    // ── Links ──
    const frontendUrl = this.config.get<string>('exchange.frontendUrl') ?? '';
    out.weburl = frontendUrl;
    const orderLink =
      ctx.orderId && order
        ? publicOrderUrl(frontendUrl, tenantId, branchId, ctx.orderId)
        : '';
    out.short_link = orderLink || frontendUrl;
    out.publish_report_url = out.short_link;
    out.password = ''; // the public report page needs no password

    // ── Location (home-collection address, else the branch) ──
    const homeAddress = order?.diagnostics?.isHomeVisit
      ? (order.diagnostics.collectionAddress ?? '').trim()
      : '';
    out.location =
      homeAddress ||
      [branch?.name, branch?.addressLine, branch?.city]
        .filter((p): p is string => !!p && !!p.trim())
        .join(', ');

    if (!order || !ctx.orderId) return;

    // ── Order & payment ──
    const code = order.orderCode ?? ctx.orderId;
    out.order_code = code;
    out.order_number = code;
    out.bill_id = order.billId ?? '';
    out.test_list = order.items
      .map(
        (it) =>
          it.branchLabTest?.testName ??
          it.branchLabPanel?.panelName ??
          it.direct ??
          '',
      )
      .filter(Boolean)
      .join(', ');
    const net = order.payments.reduce((s, p) => s + toNum(p.netAmount), 0);
    const paid = order.payments.reduce((s, p) => s + toNum(p.paidAmount), 0);
    const gross = order.payments.reduce((s, p) => s + toNum(p.totalAmount), 0);
    out.gross_amount = gross.toFixed(2);
    out.net_amount = net.toFixed(2);
    out.balance_amount = (net - paid).toFixed(2);

    // ── Doctor & phlebotomist ──
    const consultant = order.opd?.doctor;
    const referrer = order.referredByDoctor;
    out.doctor_name = consultant
      ? fullName([consultant.firstName, consultant.lastName])
      : referrer
        ? fullName([referrer.firstName, referrer.middleName, referrer.lastName])
        : '';
    out.doctor_business_name = referrer?.hospitalName ?? '';
    const phleb = order.diagnostics?.phlebotomist;
    if (phleb) {
      const phlebName = fullName([phleb.firstName, phleb.lastName]);
      out.phlebotomist_name = phlebName;
      out.phlebo_detail = phleb.phone
        ? `${phlebName} (${phleb.phone})`.trim()
        : phlebName;
    }
  }

  /**
   * The patient-derived tags. `email` is the caller's recipient email when one
   * was given (`null` = a non-patient recipient without email → blank), else
   * the patient's own email (the patient is the recipient).
   */
  private patientTags(
    p: PatientRow,
    recipientEmail: string | null | undefined,
  ): PatientTagValues {
    const name = fullName([p.firstName, p.middleName, p.lastName]);
    return {
      pfn: name,
      patient: name,
      patient_unique_id: p.umId ?? '',
      condition_name: conditionName(p),
      email:
        recipientEmail !== undefined ? (recipientEmail ?? '') : (p.email ?? ''),
    };
  }
}
