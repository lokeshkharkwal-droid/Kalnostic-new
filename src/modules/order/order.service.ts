import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  DoctorType,
  ExternalIdFormat,
  ExternalIdPurpose,
  Order,
  OrderStatus,
  PaymentMode,
  Prisma,
  QuotationStatus,
  RepeatIntervalUnit,
  SampleSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { OrderPrintType } from './dto/print-order.dto';
import { AppointmentService } from '../appointment/appointment.service';
import { AccessionSampleService } from '../accession/accession-sample.service';
import { SlotReservationService } from '../phlebotomist-schedule/slot-reservation.service';
import { PhlebotomistCollectionService } from '../phlebotomist-collection/phlebotomist-collection.service';
import { RegistrationSettingsService } from '../registration-settings/registration-settings.service';
import { ExternalIdService } from '../registration-settings/external-id.service';
import type { GeneratePdfDto } from '../pdf-report-template/dto/generate-pdf.dto';
import { PaginatedResult } from '../../common/dto/response.dto';
import { addInterval, subtractInterval } from '../../common/utils';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import type { OrderNoteCategoryValue } from './dto/create-order-note.dto';
import { ListOrderNotesDto } from './dto/list-order-notes.dto';
import { OrderItemDto } from './dto/order-item.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import { BillingDetailsDto } from './dto/billing-details.dto';
import { OrderDiagnosticsDto } from './dto/order-diagnostics.dto';
import { OrderOpdDto } from './dto/order-opd.dto';
import { OrderRadiologyDto } from './dto/order-radiology.dto';
import {
  ORDER_INCLUDE,
  ORDER_LIST_INCLUDE,
  OrderListRow,
  OrderWithRelations,
  derivePaymentStatus,
} from './entities/order.entity';
import {
  AppointmentSectionRequiredException,
  OrderRequiresItemsException,
  OrderHomeVisitPhlebotomistRequiredException,
  OrderHomeVisitSlotRequiredException,
  InvalidOrderItemException,
  OrderItemNotFoundException,
  OrderBranchLabPanelNotFoundException,
  OrderBranchLabTestNotFoundException,
  OrderCodeConflictException,
  OrderConsultantDoctorNotFoundException,
  OrderDepartmentNotFoundException,
  OrderCategoryNotFoundException,
  OrderDiagnosticPanelNotFoundException,
  OrderExternalReferralNotFoundException,
  OrderAlreadyCancelledException,
  OrderInternalReferralNotFoundException,
  OrderNotFoundException,
  OrderOutsourceCenterNotEligibleException,
  OrderOutsourceCenterNotFoundException,
  OrderPatientNotFoundException,
  OrderPersonNotFoundException,
  OrderReferralDoctorNotFoundException,
  OrderReferralPanelNotFoundException,
  NoActiveOrderPrintTemplateException,
  AmbiguousOrderPrintTemplateException,
  NotAQuotationException,
  QuotationNotExpiredException,
  QuotationDuplicationNotAllowedException,
  PreviousDuesNotClearedException,
  PreviousDuesOverpaymentException,
  FullPaymentRequiredException,
  PartialPaymentBelowMinimumException,
  ExternalOrderIdRequiredException,
  DuplicateExternalOrderIdException,
} from './exceptions/order.exceptions';
// Reused so an inline order-payment overpayment raises the SAME
// `PAYMENT_OVERPAYMENT` error the standalone `POST /payments` guard does. This
// imports an exception class (not a service), so rule #3 is not violated.
import { PaymentOverpaymentException } from '../payment-details/exceptions/payment-details.exceptions';

/**
 * Order Management — the orchestrator. Tenant-scoped (RLS) + branch-level
 * (CLAUDE.md §4.5/§4.7). The create endpoint validates every foreign reference
 * against the caller's tenant, then builds the whole order graph (order + items
 * + optional sections + payments) in one `withTenant` transaction, generating a
 * per-tenant sequential `orderCode` (`ORD-00001`…) from `Tenant.orderCounter`.
 * Prisma-direct; every foreign reference is validated against the tenant. The
 * radiologist/phlebotomist references are staff `Person`s (validated as active
 * persons). Reads always filter `{ tenantId, deletedAt: null }`.
 */
/**
 * One row in an Order Overview note stream. Unifies order-store notes
 * (`source: 'ORDER'`, editable-in-future) and the read-only accession sample
 * notes merged into the SAMPLE tab (`source: 'ACCESSION'`), so the frontend
 * renders one chronological history per tab regardless of origin.
 */
export interface OrderNoteView {
  id: string;
  category: OrderNoteCategoryValue;
  body: string;
  createdByName: string | null;
  createdAt: Date;
  source: 'ORDER' | 'ACCESSION';
  readonly: boolean;
  /** Only set for accession-sourced SAMPLE notes (e.g. 'collect', 'accept'). */
  action?: string;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
    private readonly accessionSamples: AccessionSampleService,
    private readonly slotReservation: SlotReservationService,
    private readonly homeVisitCollections: PhlebotomistCollectionService,
    private readonly pdfReportTemplateService: PdfReportTemplateService,
    private readonly registrationSettingsService: RegistrationSettingsService,
    private readonly externalIdService: ExternalIdService,
  ) {}

  /**
   * True when an order at `status` is a confirmed diagnostic order — the point at
   * which its accession samples are generated (PDF: samples enter accession once
   * an order is placed/booked). Never DRAFT/QUOTE/CANCELLED, and only when the
   * diagnostics section is present.
   */
  private shouldGenerateSamples(
    status: OrderStatus | undefined,
    hasDiagnostics: boolean,
  ): boolean {
    return (
      hasDiagnostics &&
      (status === OrderStatus.ORDER || status === OrderStatus.APPOINTMENT)
    );
  }

  /**
   * Resolve the home-visit slot reservation implied by an order's diagnostics
   * section, or null when it is not a capacity-consuming home-visit booking.
   * A booking consumes a phlebotomist slot when the order is a **confirmed**
   * booking (status `APPOINTMENT` or `ORDER` — never `DRAFT`/`QUOTE`/`CANCELLED`),
   * the diagnostics section is a home visit with a phlebotomist, a visit time is
   * present, and the order is branch-scoped. This matches the set of visits the
   * derived occupancy counts (`visitTimesInRange`) so the persisted counter, the
   * picker's availability, and `reconcile` all agree. The reservation time mirrors
   * the occupancy derivation: `collectionAt ?? appointmentAt`.
   */
  private homeVisitReservation(
    status: OrderStatus | undefined,
    branchId: string | null,
    d:
      | {
          isHomeVisit?: boolean | null;
          phlebotomistId?: string | null;
          collectionAt?: Date | string | null;
          appointmentAt?: Date | string | null;
        }
      | null
      | undefined,
  ): { branchId: string; phlebotomistId: string; at: Date } | null {
    if (status !== OrderStatus.APPOINTMENT && status !== OrderStatus.ORDER) {
      return null;
    }
    if (!branchId || !d?.isHomeVisit || !d.phlebotomistId) return null;
    const when = d.collectionAt ?? d.appointmentAt;
    if (!when) return null;
    return { branchId, phlebotomistId: d.phlebotomistId, at: new Date(when) };
  }

  /**
   * Create an order with everything the frontend submits (items, sections,
   * payments). All refs are validated first; the graph is then created in one
   * transaction. `tenantId`/`branchId` come from context; `orderCode` is
   * system-generated.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; may be null)
   * @param personId acting person id (from JWT) — recorded on the linked appointment
   * @param dto validated payload
   * @returns the fully-composed created order
   * @throws OrderPatientNotFoundException, reference-validation 422s, OrderCodeConflictException
   */
  async create(
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    dto: CreateOrderDto,
  ): Promise<OrderWithRelations> {
    await this.assertPatient(tenantId, dto.patientId);
    await this.assertItems(tenantId, dto.items);
    await this.assertReferrals(tenantId, dto);
    if (dto.diagnostics) {
      await this.assertDiagnostics(tenantId, dto.diagnostics);
    }
    if (dto.opd) {
      await this.assertOpd(tenantId, dto.opd);
    }
    if (dto.radiology) {
      await this.assertRadiology(tenantId, dto.radiology);
    }
    this.assertAppointmentSection(dto.status, dto);
    this.assertFinalizedOrder({
      status: dto.status,
      itemCount: dto.items?.length ?? 0,
      diagnostics: dto.diagnostics
        ? {
            isHomeVisit: dto.diagnostics.isHomeVisit ?? false,
            phlebotomistId: dto.diagnostics.phlebotomistId ?? null,
            collectionAt: dto.diagnostics.collectionAt
              ? new Date(dto.diagnostics.collectionAt)
              : null,
          }
        : null,
    });

    // When saving as APPOINTMENT, the order's appointment date/type are derived
    // from whichever service section is scheduled (Diagnostic / OPD / Radiology).
    const { appointmentAt, appointmentType } = this.resolveAppointment(dto);

    // Derive the stored payment status from the inline payment ledger (if any).
    const payNet = (dto.payments ?? []).reduce(
      (s, p) => s + (p.netAmount ?? 0),
      0,
    );
    const payPaid = (dto.payments ?? []).reduce(
      (s, p) => s + (p.paidAmount ?? 0),
      0,
    );
    // The total paid can never exceed the amount owed (`netAmount`, which the
    // caller sets to the payable). Blocks overpayment across every workflow
    // (ORDER / APPOINTMENT / QUOTE / DRAFT) since all route through create().
    if (payPaid > payNet) {
      throw new PaymentOverpaymentException(payNet, payPaid);
    }
    const paymentStatus = derivePaymentStatus(payNet, payPaid);

    // Enforce the branch's Previous-Dues + Partial-Billing rules (Registration
    // Settings → Charges & Deductions). Only bites when finalizing a real order
    // (`status = ORDER`) at a branch; DRAFT/QUOTE/APPOINTMENT are exempt.
    await this.assertBillingRules({
      tenantId,
      branchId,
      status: dto.status,
      patientId: dto.patientId,
      payments: dto.payments,
      previousDuesCleared: dto.previousDuesCleared ?? 0,
    });

    // Snapshot each item's list unit price from its branch lab test/panel row so
    // the order's prices are stable even if the list is later re-priced (§B5).
    const itemPrices = await this.loadItemUnitPrices(
      tenantId,
      branchId,
      dto.items ?? [],
    );

    // Resolve the branch's external Order/Quote id configuration (Registration
    // Settings). A quote (status QUOTE) uses the QUOTATION format + its own
    // counter; everything else uses the ORDER format. When the format is NONE
    // the operator must type the id manually (required on a finalized
    // ORDER/QUOTE, unique per branch); otherwise it is auto-generated inside the
    // transaction below. Only meaningful when the order is branch-scoped.
    const isQuote = dto.status === OrderStatus.QUOTE;
    const externalIdPurpose = isQuote
      ? ExternalIdPurpose.QUOTATION
      : ExternalIdPurpose.ORDER;
    const externalIdFormat = branchId
      ? await this.externalIdService.getConfiguredFormat(
          tenantId,
          branchId,
          externalIdPurpose,
        )
      : ExternalIdFormat.NONE;
    const externalIdIsManual = externalIdFormat === ExternalIdFormat.NONE;
    const manualExternalId = dto.externalOrderId?.trim() || null;
    // Manual id is mandatory on a finalized order/quotation (DRAFT/APPOINTMENT
    // exempt — mirrors assertBillingRules).
    const requiresManualExternalId =
      dto.status === OrderStatus.ORDER || dto.status === OrderStatus.QUOTE;
    if (
      branchId &&
      externalIdIsManual &&
      requiresManualExternalId &&
      !manualExternalId
    ) {
      throw new ExternalOrderIdRequiredException(isQuote);
    }

    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        // A diagnostic order is a bill — bump the per-tenant diagnostic bill
        // counter alongside the order counter so it gets a `DIG-001…` bill id.
        const isDiagnosticBill = Boolean(dto.diagnostics);
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: {
            orderCounter: { increment: 1 },
            ...(isDiagnosticBill
              ? { diagnosticBillCounter: { increment: 1 } }
              : {}),
          },
          select: { orderCounter: true, diagnosticBillCounter: true },
        });
        const orderCode = `ORD-${String(tenant.orderCounter).padStart(5, '0')}`;
        const billId = isDiagnosticBill
          ? `DIG-${String(tenant.diagnosticBillCounter).padStart(3, '0')}`
          : null;
        // Resolve the external Order/Quote id: auto-generate from the branch's
        // configured format (bumping its per-branch counter atomically here), or
        // take the operator's manual value (NONE) after a per-branch uniqueness
        // check. Null when there is no branch or a DRAFT with no manual value.
        let externalOrderId: string | null = null;
        if (branchId) {
          if (externalIdIsManual) {
            externalOrderId = manualExternalId;
            if (externalOrderId) {
              const dup = await tx.order.findFirst({
                where: { branchId, externalOrderId, deletedAt: null },
                select: { id: true },
              });
              if (dup) {
                throw new DuplicateExternalOrderIdException(externalOrderId);
              }
            }
          } else {
            const branchRow = await tx.branch.findUnique({
              where: { id: branchId },
              select: { shortName: true },
            });
            externalOrderId = await this.externalIdService.generateInTx(
              tx,
              tenantId,
              branchId,
              externalIdPurpose,
              externalIdFormat,
              branchRow?.shortName ?? '',
            );
          }
        }
        // For an APPOINTMENT order, create the linked lifecycle appointment
        // (initial status NEW) in the same transaction and attach it via FK.
        const appointmentId =
          dto.status === OrderStatus.APPOINTMENT && appointmentType
            ? await this.appointmentService.createInTx(
                tx,
                tenantId,
                branchId,
                personId,
                { appointmentType },
              )
            : null;
        const order = await tx.order.create({
          data: {
            tenantId,
            branchId,
            orderCode,
            billId,
            externalOrderId,
            appointmentId,
            paymentStatus,
            createdBy: personId,
            updatedBy: personId,
            status: dto.status ?? OrderStatus.DRAFT,
            orderDate: new Date(dto.orderDate),
            orderType: dto.orderType,
            billingType: dto.billingType,
            isUrgentBill: dto.isUrgentBill ?? false,
            isBillGenerated: dto.isBillGenerated ?? false,
            orderNotes: dto.orderNotes ?? null,
            orderTime: dto.orderTime ?? null,
            billingDetails:
              (dto.billingDetails as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            quotationStatus:
              dto.quotationStatus ??
              (dto.status === OrderStatus.QUOTE ? QuotationStatus.DRAFT : null),
            quotationValidTill: dto.quotationValidTill
              ? new Date(dto.quotationValidTill)
              : null,
            patientId: dto.patientId,
            appointmentAt,
            appointmentType,
            referredByDoctorId: dto.referredByDoctorId ?? null,
            referralPanelId: dto.referralPanelId ?? null,
            b2bClient: dto.b2bClient ?? null,
            internalReferralId: dto.internalReferralId ?? null,
            externalReferralId: dto.externalReferralId ?? null,
            branchLabTestListId: dto.branchLabTestListId ?? null,
            branchLabPanelListId: dto.branchLabPanelListId ?? null,
          },
        });
        // Seed the create-form's single `orderNotes` string as the first entry
        // of the Order Notes history so the Order Overview tab shows it alongside
        // any notes added later (append-only — see OrderNote / createNote).
        if (dto.orderNotes && personId) {
          await tx.orderNote.create({
            data: {
              tenantId,
              branchId,
              orderId: order.id,
              category: 'ORDER',
              body: dto.orderNotes,
              createdBy: personId,
            },
          });
        }
        if (dto.items?.length) {
          await tx.orderItem.createMany({
            data: dto.items.map((i) => ({
              tenantId,
              branchId,
              orderId: order.id,
              branchLabTestId: i.branchLabTestId ?? null,
              branchLabPanelId: i.branchLabPanelId ?? null,
              direct: i.direct ?? null,
              unitPrice:
                itemPrices.get(i.branchLabTestId ?? i.branchLabPanelId ?? '') ??
                0,
              discount: i.discount ?? 0,
              outsourceCenterId: i.outsourceCenterId ?? null,
            })),
          });
        }
        if (dto.diagnostics) {
          await tx.orderDiagnostics.create({
            data: this.diagnosticsData(
              dto.diagnostics,
              tenantId,
              branchId,
              order.id,
            ),
          });
        }
        if (dto.opd) {
          await tx.orderOpd.create({
            data: this.opdData(dto.opd, tenantId, branchId, order.id),
          });
        }
        if (dto.radiology) {
          await tx.orderRadiology.create({
            data: this.radiologyData(
              dto.radiology,
              tenantId,
              branchId,
              order.id,
            ),
          });
        }
        if (dto.payments?.length) {
          await tx.paymentDetails.createMany({
            data: dto.payments.map((p) => ({
              tenantId,
              branchId,
              orderId: order.id,
              ...p,
              paymentDate: p.paymentDate ? new Date(p.paymentDate) : null,
            })),
          });
        }
        // Cross-order settlement: an order created directly as ORDER is entering
        // the ORDER state now, so apply any amount collected toward previous dues
        // across the patient's outstanding orders (oldest first) in this same tx.
        if (
          dto.status === OrderStatus.ORDER &&
          branchId &&
          (dto.previousDuesCleared ?? 0) > 0
        ) {
          await this.settlePreviousDuesInTx(
            tx,
            tenantId,
            dto.patientId,
            dto.previousDuesCleared ?? 0,
            order.id,
            orderCode,
            this.settlementPaymentMode(dto.payments),
            new Date(dto.orderDate),
          );
        }
        // Reserve the phlebotomist slot for a home-visit appointment (atomic
        // capacity gate). Throws SlotFull/DailyCapReached/SlotUnavailable/
        // ScheduleForStaffNotFound, rolling the whole order back.
        const reservation = this.homeVisitReservation(
          dto.status,
          branchId,
          dto.diagnostics,
        );
        if (reservation) {
          await this.slotReservation.reserveInTx(
            tx,
            tenantId,
            reservation.branchId,
            reservation.phlebotomistId,
            reservation.at,
          );
        }
        // A confirmed diagnostic order enters accession: generate its samples
        // (status NEW) from the ordered items. Idempotent per order.
        if (this.shouldGenerateSamples(dto.status, Boolean(dto.diagnostics))) {
          await this.accessionSamples.generateForOrderInTx(
            tx,
            tenantId,
            branchId,
            personId,
            order.id,
          );
        }
        // Create the home-visit Collection Schedule record for a confirmed
        // home-visit order (idempotent + internally guarded on isHomeVisit /
        // phlebotomist / time / status).
        await this.homeVisitCollections.createForOrderInTx(
          tx,
          tenantId,
          branchId,
          personId,
          order.id,
        );
        return order.id;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    return this.findById(createdId, tenantId);
  }

  /**
   * Duplicate an EXPIRED quotation into a fresh DRAFT quote dated today, reusing
   * the source's patient, items (with per-line discounts), referrals, billing
   * sub-form and order-level totals. The new quote gets today's order date, so a
   * fresh validity window is computed at runtime from the current settings.
   *
   * Enforced server-side (independently of the UI): the source must have
   * originated as a quotation, must currently be expired (runtime-computed from
   * the branch's current validity window), and the branch's
   * `Quotation_AllowDuplicationOfExpiredQuotation` setting must be enabled.
   *
   * @param tenantId tenant scope (from the JWT).
   * @param branchId active branch (from the JWT profile) — scopes the settings
   *   read and the new quote.
   * @param personId the acting user (createdBy/updatedBy on the new quote).
   * @param id the source quotation's order id.
   * @returns the newly-created quotation, fully composed.
   * @throws OrderNotFoundException when the source order does not exist.
   * @throws NotAQuotationException when the source did not originate as a quote.
   * @throws QuotationNotExpiredException when the source is still within validity.
   * @throws QuotationDuplicationNotAllowedException when the setting is disabled.
   */
  async duplicateQuotation(
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    id: string,
  ): Promise<OrderWithRelations> {
    const source = await this.findById(id, tenantId);

    // Must have originated as a quotation (any non-null quotationStatus).
    if (source.quotationStatus == null) {
      throw new NotAQuotationException(id);
    }

    // Runtime expiry + gate against the branch's CURRENT settings.
    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      branchId ?? source.branchId ?? '',
    );
    const anchor = source.orderDate ?? source.createdAt;
    const expiryAt = addInterval(
      anchor,
      settings.Quotation_QuotationValidityValue,
      settings.Quotation_QuotationValidityUnit,
    );
    if (expiryAt >= new Date()) {
      throw new QuotationNotExpiredException(id);
    }
    if (!settings.Quotation_AllowDuplicationOfExpiredQuotation) {
      throw new QuotationDuplicationNotAllowedException(id);
    }

    // Rebuild a create payload from the source. Order date = today (its fresh
    // validity is then computed at runtime); status QUOTE / quotationStatus DRAFT.
    const todayIso = new Date().toISOString().slice(0, 10);
    const items: OrderItemDto[] = source.items.map((i) => ({
      branchLabTestId: i.branchLabTestId ?? undefined,
      branchLabPanelId: i.branchLabPanelId ?? undefined,
      direct: i.direct ?? undefined,
      discount: i.discount,
      outsourceCenterId: i.outsourceCenterId ?? undefined,
    }));
    // Carry the source's order-level totals onto a single fresh (unpaid) ledger row.
    const src0 = source.payments[0];
    const payments: OrderPaymentDto[] = src0
      ? [
          {
            totalAmount: src0.totalAmount ?? 0,
            orderDiscount: src0.orderDiscount ?? 0,
            netAmount: src0.netAmount ?? 0,
            payableAmount: src0.payableAmount ?? src0.netAmount ?? 0,
            paidAmount: 0,
          },
        ]
      : [];

    const dto: CreateOrderDto = {
      status: OrderStatus.QUOTE,
      quotationStatus: QuotationStatus.DRAFT,
      orderDate: todayIso,
      orderType: source.orderType,
      billingType: source.billingType,
      isUrgentBill: source.isUrgentBill,
      isBillGenerated: source.isBillGenerated,
      patientId: source.patientId,
      ...(source.orderNotes ? { orderNotes: source.orderNotes } : {}),
      ...(source.billingDetails
        ? {
            billingDetails:
              source.billingDetails as unknown as BillingDetailsDto,
          }
        : {}),
      ...(source.referredByDoctorId
        ? { referredByDoctorId: source.referredByDoctorId }
        : {}),
      ...(source.referralPanelId
        ? { referralPanelId: source.referralPanelId }
        : {}),
      ...(source.b2bClient ? { b2bClient: source.b2bClient } : {}),
      ...(source.internalReferralId
        ? { internalReferralId: source.internalReferralId }
        : {}),
      ...(source.externalReferralId
        ? { externalReferralId: source.externalReferralId }
        : {}),
      ...(source.branchLabTestListId
        ? { branchLabTestListId: source.branchLabTestListId }
        : {}),
      ...(source.branchLabPanelListId
        ? { branchLabPanelListId: source.branchLabPanelListId }
        : {}),
      ...(items.length ? { items } : {}),
      ...(payments.length ? { payments } : {}),
    };

    return this.create(tenantId, branchId, personId, dto);
  }

  /**
   * Load the list unit price (`listPrice`) for each item's branch lab test/panel,
   * keyed by that row id, so order items can snapshot a stable `unitPrice`. Direct
   * (free-text) items and unknown ids resolve to 0. Branch-scoped.
   * @param tenantId tenant scope
   * @param branchId active branch (null → no prices resolved)
   * @param items the order items to price
   */
  private async loadItemUnitPrices(
    tenantId: string,
    branchId: string | null,
    items: Array<{ branchLabTestId?: string; branchLabPanelId?: string }>,
  ): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    if (!branchId || !items.length) {
      return prices;
    }
    const testIds = items
      .map((i) => i.branchLabTestId)
      .filter((v): v is string => Boolean(v));
    const panelIds = items
      .map((i) => i.branchLabPanelId)
      .filter((v): v is string => Boolean(v));
    const [tests, panels] = await Promise.all([
      testIds.length
        ? this.prisma.branchLabTest.findMany({
            where: { id: { in: testIds }, tenantId, branchId, deletedAt: null },
            select: { id: true, listPrice: true },
          })
        : Promise.resolve([]),
      panelIds.length
        ? this.prisma.branchLabPanel.findMany({
            where: {
              id: { in: panelIds },
              tenantId,
              branchId,
              deletedAt: null,
            },
            select: { id: true, listPrice: true },
          })
        : Promise.resolve([]),
    ]);
    for (const t of tests) {
      prices.set(t.id, t.listPrice);
    }
    for (const p of panels) {
      prices.set(p.id, p.listPrice);
    }
    return prices;
  }

  /**
   * Sum a patient's outstanding previous dues — the positive
   * `netAmount − paidAmount` balance across their active, non-cancelled orders
   * (`ORDER`/`APPOINTMENT`), **business-wide** (every branch in the tenant).
   * Overpaid orders never offset others (each order is floored at 0). Tenant-wide
   * (not branch-scoped) so the figure matches the patient's true total dues to the
   * business — the Create Order "Clear Previous Dues" cap, the previous-dues gate,
   * the overpayment guard, and the oldest-first settlement all share it.
   * @param tenantId tenant scope (RLS also isolates to this tenant)
   * @param patientId the patient to total
   * @param excludeOrderId an order to exclude (e.g. the one being finalized)
   */
  private async getPatientOutstanding(
    tenantId: string,
    patientId: string,
    excludeOrderId?: string,
  ): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        patientId,
        deletedAt: null,
        status: { in: [OrderStatus.ORDER, OrderStatus.APPOINTMENT] },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
      select: {
        payments: {
          where: { deletedAt: null },
          select: { netAmount: true, paidAmount: true },
        },
      },
    });
    let outstanding = 0;
    for (const o of orders) {
      const net = o.payments.reduce((s, p) => s + p.netAmount, 0);
      const paid = o.payments.reduce((s, p) => s + p.paidAmount, 0);
      outstanding += Math.max(net - paid, 0);
    }
    return outstanding;
  }

  /**
   * Public read for the Create Order screen: a patient's **business-wide**
   * outstanding previous dues (all branches in the tenant), so the UI can display
   * them and pre-validate the Previous-Dues rules before submitting.
   * @param tenantId tenant scope (from JWT)
   * @param patientId the patient to total
   * @returns `{ outstanding }` in the same integer units as the payment ledger
   * @throws OrderPatientNotFoundException if the patient is not in the tenant
   */
  async getPatientDues(
    tenantId: string,
    patientId: string,
  ): Promise<{ outstanding: number }> {
    await this.assertPatient(tenantId, patientId);
    const outstanding = await this.getPatientOutstanding(tenantId, patientId);
    return { outstanding };
  }

  /**
   * Enforce the branch's **Previous Dues & Partial Billing** rules (Registration
   * Settings → Charges & Deductions) when an order is finalized. A no-op unless
   * `status = ORDER` and a branch is in context.
   *
   * Previous dues: when the patient still owes money and the branch does NOT
   * allow ordering without clearing dues, at least
   * `min(outstanding, MinimumPreviousDuesToClear)` must be cleared on this order.
   *
   * Partial billing: when partial billing is disabled the full `netAmount` must
   * be collected; when enabled, at least `MinimumPercentOfNetAmountToProceed`%
   * of the net must be collected.
   *
   * @throws PreviousDuesNotClearedException if the dues gate is not satisfied
   * @throws FullPaymentRequiredException if full payment is required but missing
   * @throws PartialPaymentBelowMinimumException if the paid amount is below the
   *   configured minimum percentage of the net amount
   */
  private async assertBillingRules(params: {
    tenantId: string;
    branchId: string | null;
    status: OrderStatus | undefined;
    patientId: string;
    payments:
      | Array<{ netAmount?: number | null; paidAmount?: number | null }>
      | undefined;
    previousDuesCleared: number;
    excludeOrderId?: string;
  }): Promise<void> {
    const {
      tenantId,
      branchId,
      status,
      patientId,
      payments,
      previousDuesCleared,
      excludeOrderId,
    } = params;
    if (status !== OrderStatus.ORDER || !branchId) return;

    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      branchId,
    );

    // ── Previous-dues gate ──
    // Compute the outstanding balance whenever it could matter — either the
    // branch enforces clearing, or the caller is clearing something (which we
    // must bound against what's actually owed).
    const duesGateActive =
      !settings.ChargesAndDeductions_AllowOrderWithoutClearingPreviousDues;
    if (duesGateActive || previousDuesCleared > 0) {
      const outstanding = await this.getPatientOutstanding(
        tenantId,
        patientId,
        excludeOrderId,
      );
      // Can't clear more dues than are owed (settlement is capped at the balance).
      if (previousDuesCleared > outstanding) {
        throw new PreviousDuesOverpaymentException(
          outstanding,
          previousDuesCleared,
        );
      }
      if (duesGateActive && outstanding > 0) {
        const minToClear = Number(
          settings.ChargesAndDeductions_MinimumPreviousDuesToClear,
        );
        // Toggle OFF ⇒ the full outstanding must be cleared by default; a
        // positive configured minimum relaxes it to just that amount (capped at
        // what's owed). A minimum of 0 means "no explicit minimum" — not "clear
        // nothing" — so it falls back to full clearance.
        const required =
          minToClear > 0 ? Math.min(outstanding, minToClear) : outstanding;
        if (previousDuesCleared < required) {
          throw new PreviousDuesNotClearedException(
            outstanding,
            required,
            previousDuesCleared,
          );
        }
      }
    }

    // ── Partial-billing gate ──
    const net = (payments ?? []).reduce((s, p) => s + (p.netAmount ?? 0), 0);
    const paid = (payments ?? []).reduce((s, p) => s + (p.paidAmount ?? 0), 0);
    if (net > 0) {
      if (!settings.ChargesAndDeductions_AllowPartialBilling) {
        if (paid < net) {
          throw new FullPaymentRequiredException(net, paid);
        }
      } else {
        const minPercent =
          settings.ChargesAndDeductions_MinimumPercentOfNetAmountToProceed;
        const minRequired = Math.ceil((net * minPercent) / 100);
        if (paid < minRequired) {
          throw new PartialPaymentBelowMinimumException(
            net,
            paid,
            minPercent,
            minRequired,
          );
        }
      }
    }
  }

  /**
   * Apply an amount collected toward a patient's **previous dues** across their
   * outstanding orders, **oldest first**, inside the given transaction. For each
   * order with a positive balance (from oldest `orderDate`, then `createdAt`), a
   * settlement `PaymentDetails` row is written (a pure payment: `paidAmount =
   * applied`, no net) referencing the new order, and the settled order's
   * `paymentStatus` is recomputed — so the patient's outstanding drops
   * immediately. Runs in the same transaction as the new order so settlement and
   * the order commit (or roll back) together.
   *
   * The caller has already validated (`assertBillingRules`) that `amount` never
   * exceeds the outstanding balance, so any tiny rounding remainder is a no-op.
   *
   * Settlement is **business-wide** (all branches in the tenant): the cleared
   * amount pays down the patient's oldest outstanding orders wherever they were
   * placed. Each settlement row is tagged with the settled order's own branch.
   *
   * @param tx active transaction client
   * @param tenantId tenant scope
   * @param patientId the patient whose dues are being settled
   * @param amount amount to apply (same integer units as the ledger)
   * @param newOrderId the order driving the settlement (excluded from allocation)
   * @param newOrderCode the new order's code, recorded as the settlement reference
   * @param paymentMode mode the dues were collected under (the new order's mode)
   * @param paymentDate when the dues were collected
   */
  private async settlePreviousDuesInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    amount: number,
    newOrderId: string,
    newOrderCode: string,
    paymentMode: PaymentMode,
    paymentDate: Date,
  ): Promise<void> {
    if (amount <= 0) return;
    const orders = await tx.order.findMany({
      where: {
        tenantId,
        patientId,
        deletedAt: null,
        id: { not: newOrderId },
        status: { in: [OrderStatus.ORDER, OrderStatus.APPOINTMENT] },
      },
      orderBy: [{ orderDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        branchId: true,
        payments: {
          where: { deletedAt: null },
          select: { netAmount: true, paidAmount: true },
        },
      },
    });

    let remaining = amount;
    for (const o of orders) {
      if (remaining <= 0) break;
      const net = o.payments.reduce((s, p) => s + p.netAmount, 0);
      const paid = o.payments.reduce((s, p) => s + p.paidAmount, 0);
      const balance = net - paid;
      if (balance <= 0) continue;
      const applied = Math.min(balance, remaining);
      await tx.paymentDetails.create({
        data: {
          tenantId,
          // Tag the settlement row with the SETTLED order's own branch, not the
          // new order's — the payment belongs to that order at that location.
          branchId: o.branchId,
          orderId: o.id,
          paidAmount: applied,
          remainingBalance: Math.max(balance - applied, 0),
          hasClearedPreviousDues: true,
          paymentMode,
          paymentDate,
          reference: newOrderCode,
          notes: `Previous dues settled via order ${newOrderCode}`,
        },
      });
      await tx.order.update({
        where: { id: o.id },
        data: { paymentStatus: derivePaymentStatus(net, paid + applied) },
      });
      remaining -= applied;
    }
  }

  /**
   * The payment mode a previous-dues settlement should be recorded under —
   * the new order's primary (first) payment mode, defaulting to CASH.
   */
  private settlementPaymentMode(
    payments: OrderPaymentDto[] | undefined,
  ): PaymentMode {
    return (
      payments?.find((p) => p.paymentMode)?.paymentMode ?? PaymentMode.CASH
    );
  }

  /**
   * Fetch one order fully composed (patient, items, sections, payments), scoped
   * to the caller's tenant.
   * @param id order id
   * @param tenantId tenant scope
   * @throws OrderNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new OrderNotFoundException(id);
    }
    return order;
  }

  // ── Order Overview notes (Order / Sample / Tech tabs) ───────────────────────
  //
  // Append-only note history keyed to the order. Mirrors the lab-report notes
  // feature (LABORATORY.docx §4.2) but attached to the order, so notes can be
  // added from the Order Overview page the moment an order is created. The
  // SAMPLE stream additionally merges the order's accession sample notes
  // (read-only) so the two histories connect.

  /**
   * Add a note to an order (Order Overview → Order / Sample / Tech tab). Creates
   * one append-only `OrderNote` row — existing notes are never overwritten.
   * @param id order id
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from the active profile), stored on the note
   * @param actorId author `Person.id` (from JWT)
   * @param dto category + body
   * @returns the created note in the unified `OrderNoteView` shape
   * @throws OrderNotFoundException if the order is missing/soft-deleted/other tenant
   */
  async createNote(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: CreateOrderNoteDto,
  ): Promise<OrderNoteView> {
    await this.assertOrderExists(id, tenantId);
    const note = await this.prisma.orderNote.create({
      data: {
        tenantId,
        branchId,
        orderId: id,
        category: dto.category,
        body: dto.body,
        createdBy: actorId,
      },
    });
    const nameById = await this.resolveActorNames([note.createdBy]);
    return {
      id: note.id,
      category: note.category,
      body: note.body,
      createdByName: nameById.get(note.createdBy) ?? note.createdBy,
      createdAt: note.createdAt,
      source: 'ORDER',
      readonly: false,
    };
  }

  /**
   * List an order's notes, newest-first. Without `category`, returns all three
   * tabs' notes together. For the SAMPLE stream (requested explicitly or as part
   * of the unfiltered set) the order's accession sample notes are merged in
   * read-only, so the Order Overview Sample tab shows the complete sample history.
   * @param id order id
   * @param tenantId tenant scope (from JWT)
   * @param query optional category filter
   * @returns notes in the unified `OrderNoteView` shape, `createdAt` descending
   * @throws OrderNotFoundException if the order is missing/soft-deleted/other tenant
   */
  async findNotes(
    id: string,
    tenantId: string,
    query: ListOrderNotesDto,
  ): Promise<OrderNoteView[]> {
    await this.assertOrderExists(id, tenantId);
    const rows = await this.prisma.orderNote.findMany({
      where: {
        orderId: id,
        tenantId,
        ...(query.category ? { category: query.category } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const nameById = await this.resolveActorNames(rows.map((r) => r.createdBy));
    const notes: OrderNoteView[] = rows.map((r) => ({
      id: r.id,
      category: r.category,
      body: r.body,
      createdByName: nameById.get(r.createdBy) ?? r.createdBy,
      createdAt: r.createdAt,
      source: 'ORDER',
      readonly: false,
    }));

    if (!query.category || query.category === 'SAMPLE') {
      notes.push(...(await this.loadAccessionSampleNotes(id, tenantId)));
    }

    notes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return notes;
  }

  /**
   * Loads the read-only accession sample notes for an order — every
   * `AccessionStatusHistory` row (with a note) across the order's samples, mapped
   * into the SAMPLE `OrderNoteView` shape. These come from the accession page's
   * Collect Sample / status-update actions (CLAUDE.md §4 accession flow).
   */
  private async loadAccessionSampleNotes(
    orderId: string,
    tenantId: string,
  ): Promise<OrderNoteView[]> {
    const samples = await this.prisma.accessionSample.findMany({
      where: { orderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (samples.length === 0) return [];

    const history = await this.prisma.accessionStatusHistory.findMany({
      where: {
        tenantId,
        sampleId: { in: samples.map((s) => s.id) },
        notes: { not: null },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (history.length === 0) return [];

    const nameById = await this.resolveActorNames(
      history.map((h) => h.changedBy),
    );
    return history.map((h) => ({
      id: h.id,
      category: 'SAMPLE' as const,
      body: h.notes as string,
      createdByName: h.changedBy
        ? (nameById.get(h.changedBy) ?? h.changedBy)
        : null,
      createdAt: h.createdAt,
      source: 'ACCESSION' as const,
      readonly: true,
      action: h.action,
    }));
  }

  /**
   * Lightweight existence guard for note reads/writes — asserts the order belongs
   * to the caller's tenant and is active, without loading its full graph.
   * @throws OrderNotFoundException if missing/soft-deleted/other tenant
   */
  private async assertOrderExists(id: string, tenantId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!order) {
      throw new OrderNotFoundException(id);
    }
  }

  /**
   * Resolves logical `Person.id` actor references (an OrderNote's `createdBy`, an
   * accession history's `changedBy`) to display names, one batched lookup —
   * same unenforced-reference convention as the lab-report notes, falling back to
   * the raw id when a person can't be resolved.
   */
  private async resolveActorNames(
    actorIds: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(actorIds.filter((x): x is string => Boolean(x)))];
    const nameById = new Map<string, string>();
    if (ids.length === 0) return nameById;

    const persons = await this.prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    });
    for (const p of persons) {
      const name = [p.firstName, p.middleName, p.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      nameById.set(p.id, name || p.id);
    }
    return nameById;
  }

  // ── Print (template-driven PDF) ─────────────────────────────────────────────
  //
  // Bridges an order's real data into the `GeneratePdfDto` shape
  // `PdfReportTemplateService.generatePdf` already expects, so a user-authored
  // classic template (Old Templates → Print) is rendered against the order. One
  // endpoint (`POST /orders/:id/print`) serves the four order-scoped documents;
  // the `type` selects the context builder. Mirrors `LabReportService.print`.

  /**
   * Render one of an order's documents (order slip / bill / TRF / quotation) to a
   * PDF using the selected (or the tenant's single active) template of that type.
   * @param id order id
   * @param tenantId tenant scope (from JWT)
   * @param type which order document to render
   * @param templateId explicit template to use (the picker always sends one)
   * @returns the rendered PDF bytes
   * @throws NoActiveOrderPrintTemplateException if no active template of `type` exists
   * @throws AmbiguousOrderPrintTemplateException if several exist and no `templateId` was given
   */
  async print(
    id: string,
    tenantId: string,
    type: OrderPrintType,
    templateId?: string,
  ): Promise<Buffer> {
    const order = await this.findById(id, tenantId);
    const context = this.buildPrintContext(order, type);
    const resolvedTemplateId =
      templateId ?? (await this.resolvePrintTemplateId(tenantId, type));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      context,
    );
  }

  /**
   * Resolve the tenant's single active template for a print `type` when the caller
   * did not pass an explicit id.
   * @throws NoActiveOrderPrintTemplateException / AmbiguousOrderPrintTemplateException
   */
  private async resolvePrintTemplateId(
    tenantId: string,
    type: OrderPrintType,
  ): Promise<string> {
    const { data } = await this.pdfReportTemplateService.findAllForTenant(
      tenantId,
      1,
      10,
      { type, status: 'ACTIVE' },
    );
    if (data.length === 0) {
      throw new NoActiveOrderPrintTemplateException(tenantId, type);
    }
    if (data.length > 1) {
      throw new AmbiguousOrderPrintTemplateException(
        tenantId,
        type,
        data.map((t) => t.id),
      );
    }
    return data[0]!.id;
  }

  /** Dispatch to the per-type render-context builder. */
  private buildPrintContext(
    order: OrderWithRelations,
    type: OrderPrintType,
  ): GeneratePdfDto {
    switch (type) {
      case 'order_print':
        return this.buildOrderPrintContext(order);
      case 'bill_print':
        return this.buildBillContext(order);
      case 'trf_print':
        return this.buildTrfContext(order);
      case 'lab_quotation_print':
        return this.buildQuotationContext(order);
    }
  }

  /** Common patient `{variables}` shared by every order document. */
  private patientVariables(order: OrderWithRelations): Record<string, unknown> {
    const p = order.patient;
    return {
      patient_name: [p.firstName, p.middleName, p.lastName]
        .filter(Boolean)
        .join(' '),
      patient_age: p.age ?? '',
      patient_gender: p.gender ?? '',
      patient_um_id: p.umId ?? '',
      patient_mobile: p.mobile ?? '',
      patient_email: p.email ?? '',
      patient_blood_group: p.bloodGroup ?? '',
    };
  }

  /** Common referral `{variables}` shared by every order document. */
  private referralVariables(
    order: OrderWithRelations,
  ): Record<string, unknown> {
    return {
      referred_by: order.referredByDoctor
        ? [order.referredByDoctor.firstName, order.referredByDoctor.lastName]
            .filter(Boolean)
            .join(' ')
        : '',
      referral_panel: order.referralPanel?.name ?? '',
    };
  }

  /** One `sections.items` row per active order item (test / panel / direct). */
  private itemRows(order: OrderWithRelations): Array<Record<string, unknown>> {
    return order.items.map((it, i) => {
      const test = it.branchLabTest;
      const panel = it.branchLabPanel;
      return {
        sr_no: i + 1,
        name: test?.testName ?? panel?.panelName ?? it.direct ?? '',
        code: test?.testCode ?? panel?.panelCode ?? '',
        type: test ? 'Test' : panel ? 'Panel' : 'Direct',
        price: Number(test?.priceMsrp ?? panel?.priceMsrp ?? 0),
        discount: it.discount ?? 0,
      };
    });
  }

  /** Summed bill totals across the active payment ledger (minor units). */
  private billTotals(order: OrderWithRelations): {
    gross: number;
    discount: number;
    net: number;
    paid: number;
    balance: number;
  } {
    const sum = (pick: (p: OrderWithRelations['payments'][number]) => number) =>
      order.payments.reduce((acc, p) => acc + pick(p), 0);
    const gross = sum((p) => p.totalAmount);
    const discount = sum((p) => p.orderDiscount);
    const net = sum((p) => p.netAmount);
    const paid = sum((p) => p.paidAmount);
    return { gross, discount, net, paid, balance: net - paid };
  }

  /** Format a DATE-only value as `YYYY-MM-DD` (empty when null). */
  private dateOnly(value: Date | null | undefined): string {
    return value ? value.toISOString().slice(0, 10) : '';
  }

  /** `order_print` — order slip: header, patient, referral, item list. */
  private buildOrderPrintContext(order: OrderWithRelations): GeneratePdfDto {
    return {
      variables: {
        order_code: order.orderCode,
        bill_id: order.billId ?? '',
        order_date: this.dateOnly(order.orderDate),
        order_time: order.orderTime ?? '',
        status: order.status,
        branch_name: order.branch?.name ?? '',
        item_count: order.items.length,
        ...this.patientVariables(order),
        ...this.referralVariables(order),
      },
      sections: { items: this.itemRows(order) },
    };
  }

  /** `bill_print` — patient bill: amounts + item list + payment history. */
  private buildBillContext(order: OrderWithRelations): GeneratePdfDto {
    const totals = this.billTotals(order);
    return {
      variables: {
        bill_id: order.billId ?? order.orderCode,
        order_code: order.orderCode,
        order_date: this.dateOnly(order.orderDate),
        status: order.status,
        payment_status: order.paymentStatus,
        branch_name: order.branch?.name ?? '',
        gross_amount: totals.gross,
        discount_amount: totals.discount,
        net_amount: totals.net,
        paid_amount: totals.paid,
        balance_amount: totals.balance,
        ...this.patientVariables(order),
        ...this.referralVariables(order),
      },
      sections: {
        items: this.itemRows(order),
        payments: order.payments.map((pd) => ({
          date: this.dateOnly(pd.paymentDate),
          mode: pd.paymentMode,
          reference: pd.reference ?? '',
          amount: pd.paidAmount,
        })),
      },
    };
  }

  /** `trf_print` — Test Requisition Form: requested tests + clinical notes. */
  private buildTrfContext(order: OrderWithRelations): GeneratePdfDto {
    return {
      variables: {
        trf_ref: order.billId ?? order.orderCode,
        order_code: order.orderCode,
        order_date: this.dateOnly(order.orderDate),
        clinical_notes: order.orderNotes ?? '',
        branch_name: order.branch?.name ?? '',
        ...this.patientVariables(order),
        ...this.referralVariables(order),
      },
      sections: {
        tests: order.items.map((it, i) => {
          const test = it.branchLabTest;
          const panel = it.branchLabPanel;
          return {
            sr_no: i + 1,
            name: test?.testName ?? panel?.panelName ?? it.direct ?? '',
            code: test?.testCode ?? panel?.panelCode ?? '',
            status: 'REQUESTED',
          };
        }),
      },
    };
  }

  /** `lab_quotation_print` — the quotation: items + totals + validity. */
  private buildQuotationContext(order: OrderWithRelations): GeneratePdfDto {
    const totals = this.billTotals(order);
    return {
      variables: {
        quote_id: order.orderCode,
        quote_date: this.dateOnly(order.orderDate),
        valid_till: this.dateOnly(order.quotationValidTill),
        status: order.quotationStatus ?? '',
        branch_name: order.branch?.name ?? '',
        gross_amount: totals.gross,
        discount_amount: totals.discount,
        net_amount: totals.net,
        ...this.patientVariables(order),
        ...this.referralVariables(order),
      },
      sections: { items: this.itemRows(order) },
    };
  }

  /**
   * List orders in the caller's tenant (offset pagination) with the patient ref,
   * referral refs, payment rollups (gross/discount/net) and active-item count.
   * Supports `search` (order code OR patient name/mobile/UMID)/`quoteId`
   * (`orderCode`), status/type/billing filters, patient id/name/mobile filters,
   * the four referral filters, `isBillGenerated`, an `orderDate` range, a
   * `quotationStatus` filter (EXPIRED derived from `quotationValidTill`), a
   * `section` scope, department/lab-test/lab-panel item filters, a derived
   * `sampleStatus` (PENDING/PARTIAL/COLLECTED), and the diagnostics flags
   * `isHomeVisit`/`isOutsource`/`isUrgent`. Defaults branch scope to the active branch;
   * an explicit `query.branchId` overrides it (SiteAdmin/cross-branch tooling).
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from JWT profile; may be null)
   * @param query search + filters + pagination
   */
  async findAll(
    tenantId: string,
    activeBranchId: string | null,
    query: ListOrdersDto,
  ): Promise<PaginatedResult<OrderListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.OrderWhereInput = { tenantId, deletedAt: null };
    // Extra clauses are pushed here so independent filters compose (never
    // clobber each other by re-assigning `where.AND`).
    const and: Prisma.OrderWhereInput[] = [];

    // Branch scope: explicit query.branchId wins; otherwise default to the
    // active branch (null active branch = tenant-wide for tenant-level profiles).
    const branchId = query.branchId ?? activeBranchId;
    if (branchId) where.branchId = branchId;

    // Quote ID takes precedence over the generic search. A bare `search`
    // matches the order code OR any of the patient's name / mobile / UMID.
    const quoteId = query.quoteId?.trim();
    const search = query.search?.trim();
    if (quoteId) {
      where.orderCode = { contains: quoteId, mode: 'insensitive' };
    } else if (search) {
      where.OR = [
        { orderCode: { contains: search, mode: 'insensitive' } },
        { billId: { contains: search, mode: 'insensitive' } },
        {
          patient: {
            is: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { middleName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search, mode: 'insensitive' } },
                { umId: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    if (query.status) where.status = query.status;
    // Scope to quotation-origin records (any non-null quotationStatus) so
    // converted quotes (now status = ORDER) stay on the Quotations screen. A
    // specific quotationStatus filter below overrides this broader scope.
    if (query.isQuotation && !query.quotationStatus) {
      where.quotationStatus = { not: null };
    }
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.appointmentStatus) {
      where.appointment = { is: { status: query.appointmentStatus } };
    }
    if (query.orderType) where.orderType = query.orderType;
    if (query.billingType) where.billingType = query.billingType;
    if (query.patientId) where.patientId = query.patientId;
    if (query.referredByDoctorId) {
      where.referredByDoctorId = query.referredByDoctorId;
    }
    if (query.referralPanelId) where.referralPanelId = query.referralPanelId;
    // B2B filter: presence (or absence) of a referral panel. Pushed to `and[]`
    // so it never clobbers an explicit `referralPanelId` filter.
    if (query.isB2b !== undefined) {
      and.push({ referralPanelId: query.isB2b ? { not: null } : null });
    }
    if (query.internalReferralId) {
      where.internalReferralId = query.internalReferralId;
    }
    if (query.externalReferralId) {
      where.externalReferralId = query.externalReferralId;
    }
    if (query.isBillGenerated !== undefined) {
      where.isBillGenerated = query.isBillGenerated;
    }
    if (query.isUrgent !== undefined) where.isUrgentBill = query.isUrgent;
    if (query.dateFrom || query.dateTo) {
      where.orderDate = {};
      if (query.dateFrom) where.orderDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.orderDate.lte = new Date(query.dateTo);
    }
    // Appointment-date range (filters `appointmentAt`, which carries a time, so
    // the upper bound is stretched to the end of that day to stay inclusive).
    if (query.appointmentDateFrom || query.appointmentDateTo) {
      where.appointmentAt = {};
      if (query.appointmentDateFrom) {
        where.appointmentAt.gte = new Date(query.appointmentDateFrom);
      }
      if (query.appointmentDateTo) {
        const end = new Date(query.appointmentDateTo);
        end.setUTCHours(23, 59, 59, 999);
        where.appointmentAt.lte = end;
      }
    }

    // Section scope + diagnostics-only flags collapse into one relation filter
    // on the diagnostics section (so an order without a diagnostics row is
    // excluded when any of these is set).
    const diagnosticsWhere: Prisma.OrderDiagnosticsWhereInput = {};
    let hasDiagnosticsFilter = query.section === 'DIAGNOSTICS';
    if (query.isHomeVisit !== undefined) {
      diagnosticsWhere.isHomeVisit = query.isHomeVisit;
      hasDiagnosticsFilter = true;
    }
    if (query.isOutsource !== undefined) {
      diagnosticsWhere.sampleSource = query.isOutsource
        ? SampleSource.SUPPLIED
        : SampleSource.IN_HOUSE;
      hasDiagnosticsFilter = true;
    }
    if (hasDiagnosticsFilter) where.diagnostics = { is: diagnosticsWhere };
    if (query.section === 'OPD') where.opd = { is: {} };
    if (query.section === 'RADIOLOGY') where.radiology = { is: {} };

    // Item-relation filters (department / test / panel / sample status) are
    // pushed as separate AND clauses so several can co-exist without a single
    // `items` key overwriting the others.
    if (query.departmentId) {
      and.push({
        items: {
          some: {
            deletedAt: null,
            OR: [
              { branchLabTest: { is: { departmentId: query.departmentId } } },
              { branchLabPanel: { is: { departmentId: query.departmentId } } },
            ],
          },
        },
      });
    }
    if (query.branchLabTestId) {
      and.push({
        items: {
          some: { deletedAt: null, branchLabTestId: query.branchLabTestId },
        },
      });
    }
    if (query.branchLabPanelId) {
      and.push({
        items: {
          some: { deletedAt: null, branchLabPanelId: query.branchLabPanelId },
        },
      });
    }
    if (query.sampleStatus) {
      switch (query.sampleStatus) {
        case 'PENDING':
          // Has items, none collected.
          and.push({ items: { some: { deletedAt: null } } });
          and.push({
            items: { none: { deletedAt: null, collectedAt: { not: null } } },
          });
          break;
        case 'COLLECTED':
          // Has items, none still uncollected.
          and.push({ items: { some: { deletedAt: null } } });
          and.push({
            items: { none: { deletedAt: null, collectedAt: null } },
          });
          break;
        case 'PARTIAL':
          // At least one collected and at least one still uncollected.
          and.push({
            items: { some: { deletedAt: null, collectedAt: { not: null } } },
          });
          and.push({
            items: { some: { deletedAt: null, collectedAt: null } },
          });
          break;
      }
    }

    // Patient name / mobile via the to-one patient relation filter.
    const patientName = query.patientName?.trim();
    const patientMobile = query.patientMobile?.trim();
    if (patientName || patientMobile) {
      const patientWhere: Prisma.PatientWhereInput = {};
      if (patientName) {
        patientWhere.OR = [
          { firstName: { contains: patientName, mode: 'insensitive' } },
          { middleName: { contains: patientName, mode: 'insensitive' } },
          { lastName: { contains: patientName, mode: 'insensitive' } },
        ];
      }
      if (patientMobile) {
        patientWhere.mobile = { contains: patientMobile, mode: 'insensitive' };
      }
      where.patient = { is: patientWhere };
    }

    // ── Quotation expiry: computed at RUNTIME from the CURRENT branch settings
    // + each quote's order date (no cron, no persisted "expired" flag). We read
    // the branch's validity (value + unit) once and derive a single cutoff
    // instant: a DRAFT quote is EXPIRED once its order date is older than
    // (now − validity). Scoped to the Quotations screen (`isQuotation`); other
    // order listings keep the raw stored status (`quotationExpiryCutoff` stays
    // null). Degrades gracefully to "nothing expired" when no branch is
    // resolvable (e.g. a tenant-level profile). ──
    const now = new Date();
    let quotationValidityValue: number | null = null;
    let quotationValidityUnit: RepeatIntervalUnit | null = null;
    let quotationExpiryCutoff: Date | null = null;
    if (query.isQuotation && branchId) {
      const settings = await this.registrationSettingsService.getForBranch(
        tenantId,
        branchId,
      );
      quotationValidityValue = settings.Quotation_QuotationValidityValue;
      quotationValidityUnit = settings.Quotation_QuotationValidityUnit;
      quotationExpiryCutoff = subtractInterval(
        now,
        quotationValidityValue,
        quotationValidityUnit,
      );
    }

    if (query.quotationStatus) {
      switch (query.quotationStatus) {
        case QuotationStatus.CONVERTED:
          where.quotationStatus = QuotationStatus.CONVERTED;
          break;
        case QuotationStatus.EXPIRED:
          // A DRAFT quote whose order date has passed the current validity
          // window (or a legacy row already stored as EXPIRED).
          and.push({
            OR: [
              { quotationStatus: QuotationStatus.EXPIRED },
              ...(quotationExpiryCutoff
                ? [
                    {
                      quotationStatus: QuotationStatus.DRAFT,
                      orderDate: { lt: quotationExpiryCutoff },
                    },
                  ]
                : []),
            ],
          });
          break;
        case QuotationStatus.DRAFT:
          // DRAFT that is still within its validity window.
          where.quotationStatus = QuotationStatus.DRAFT;
          if (quotationExpiryCutoff) {
            and.push({ orderDate: { gte: quotationExpiryCutoff } });
          }
          break;
      }
    }

    if (and.length) where.AND = and;

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    const counts = await this.countItemsByOrder(
      tenantId,
      rows.map((r) => r.id),
    );
    const data: OrderListRow[] = rows.map((r) => {
      const grossAmount = r.payments.reduce((s, p) => s + p.totalAmount, 0);
      const discountAmount = r.payments.reduce(
        (s, p) => s + p.orderDiscount,
        0,
      );
      const netAmount = r.payments.reduce((s, p) => s + p.netAmount, 0);
      const paidAmount = r.payments.reduce((s, p) => s + p.paidAmount, 0);
      const count = counts.get(r.id);
      // Runtime expiry (Quotations screen only): anchor on the order date, or
      // the quote's createdAt when no order date is set. `computedQuotationExpiryAt`
      // is the absolute expiry the FE renders as "valid till"; a DRAFT quote is
      // EXPIRED once its anchor predates the cutoff. Null cutoff (non-quotation
      // listing / no branch) leaves the raw stored status untouched.
      const quoteAnchor = r.orderDate ?? r.createdAt;
      const computedQuotationExpiryAt =
        quotationValidityValue != null && quotationValidityUnit != null
          ? addInterval(
              quoteAnchor,
              quotationValidityValue,
              quotationValidityUnit,
            )
          : null;
      const effectiveQuotationStatus =
        quotationExpiryCutoff != null &&
        r.quotationStatus === QuotationStatus.DRAFT &&
        quoteAnchor < quotationExpiryCutoff
          ? QuotationStatus.EXPIRED
          : r.quotationStatus;
      return {
        ...r,
        itemCount: count?.total ?? 0,
        collectedItemCount: count?.collected ?? 0,
        grossAmount,
        discountAmount,
        netAmount,
        paidAmount,
        effectiveQuotationStatus,
        computedQuotationExpiryAt,
      };
    });
    return { data, total, page, limit };
  }

  /**
   * Update an order. Scalars (incl. `status`) are patched; when `items` is
   * provided the whole set is replaced; a provided section object is upserted.
   * All in one transaction.
   * @param id order id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws OrderNotFoundException / reference 422s
   */
  async update(
    id: string,
    tenantId: string,
    personId: string | null,
    dto: UpdateOrderDto,
  ): Promise<OrderWithRelations> {
    await this.findById(id, tenantId);
    await this.assertItems(tenantId, dto.items);
    await this.assertReferrals(tenantId, dto);
    if (dto.diagnostics) {
      await this.assertDiagnostics(tenantId, dto.diagnostics);
    }
    if (dto.opd) {
      await this.assertOpd(tenantId, dto.opd);
    }
    if (dto.radiology) {
      await this.assertRadiology(tenantId, dto.radiology);
    }
    this.assertAppointmentSection(dto.status, dto);

    const now = new Date();
    // Existing order: branch (sections/items inherit it), current status, any
    // already-linked appointment (so a status flip to APPOINTMENT can create one),
    // and the current diagnostics booking (to release/re-reserve the phleb slot).
    const existing = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        branchId: true,
        status: true,
        patientId: true,
        orderCode: true,
        externalOrderId: true,
        appointmentId: true,
        appointment: { select: { status: true } },
        diagnostics: {
          select: {
            isHomeVisit: true,
            phlebotomistId: true,
            collectionAt: true,
            appointmentAt: true,
          },
        },
      },
    });
    const branchId = existing?.branchId ?? null;
    const effectiveStatus = dto.status ?? existing?.status;

    // Full new-order field parity for finalization (e.g. draft → ORDER): validate
    // the EFFECTIVE order — the incoming patch merged over the persisted draft —
    // so a bare `{ status: "ORDER" }` still checks the draft's real items and
    // diagnostics. `items`/`diagnostics` fall back to what's already stored when
    // this patch omits them.
    const effectiveItemCount =
      dto.items !== undefined
        ? dto.items.length
        : await this.prisma.orderItem.count({
            where: { orderId: id, tenantId, deletedAt: null },
          });
    const effectiveDiagnostics = dto.diagnostics
      ? {
          isHomeVisit: dto.diagnostics.isHomeVisit ?? false,
          phlebotomistId: dto.diagnostics.phlebotomistId ?? null,
          collectionAt: dto.diagnostics.collectionAt
            ? new Date(dto.diagnostics.collectionAt)
            : null,
        }
      : (existing?.diagnostics ?? null);
    this.assertFinalizedOrder({
      status: effectiveStatus,
      itemCount: effectiveItemCount,
      diagnostics: effectiveDiagnostics,
    });

    // Home-visit slot reservation: the booking as it stands now vs. after this
    // patch. A cancelled appointment already released its slot, so it counts as no
    // current reservation. The diagnostics section is unchanged when the patch
    // omits it.
    const oldReservation =
      existing?.appointment?.status === AppointmentStatus.CANCELLED
        ? null
        : this.homeVisitReservation(
            existing?.status,
            branchId,
            existing?.diagnostics,
          );
    const newReservation = this.homeVisitReservation(
      effectiveStatus,
      branchId,
      dto.diagnostics ?? existing?.diagnostics,
    );
    const reservationUnchanged =
      oldReservation !== null &&
      newReservation !== null &&
      oldReservation.phlebotomistId === newReservation.phlebotomistId &&
      oldReservation.at.getTime() === newReservation.at.getTime();

    // Appointment date: prefer a scheduled section, then the top-level field;
    // `undefined` leaves it untouched (patch semantics).
    const sectionAppt =
      dto.diagnostics?.appointmentAt ??
      dto.opd?.appointmentAt ??
      dto.radiology?.appointmentAt ??
      dto.appointmentAt;
    const appointmentType = this.sectionAppointmentType(dto);

    // When the payment ledger is being replaced, recompute the stored payment
    // status from the incoming rows (same derivation as create).
    const payNet = (dto.payments ?? []).reduce(
      (s, p) => s + (p.netAmount ?? 0),
      0,
    );
    const payPaid = (dto.payments ?? []).reduce(
      (s, p) => s + (p.paidAmount ?? 0),
      0,
    );
    // Same overpayment guard as create, but only when the ledger is part of
    // this patch (an update without `payments` leaves the stored totals alone).
    if (dto.payments !== undefined && payPaid > payNet) {
      throw new PaymentOverpaymentException(payNet, payPaid);
    }
    const paymentStatus = derivePaymentStatus(payNet, payPaid);

    // Enforce the branch's Previous-Dues + Partial-Billing rules when a draft is
    // finalized (or an order re-saved) to `status = ORDER`. Uses the incoming
    // ledger when this patch replaces it, otherwise the order's stored ledger.
    if (effectiveStatus === OrderStatus.ORDER) {
      const effectivePayments =
        dto.payments !== undefined
          ? dto.payments
          : await this.prisma.paymentDetails.findMany({
              where: { orderId: id, tenantId, deletedAt: null },
              select: { netAmount: true, paidAmount: true },
            });
      if (existing?.patientId) {
        await this.assertBillingRules({
          tenantId,
          branchId,
          status: OrderStatus.ORDER,
          patientId: existing.patientId,
          payments: effectivePayments,
          previousDuesCleared: dto.previousDuesCleared ?? 0,
          excludeOrderId: id,
        });
      }
    }

    // External Order/Quote id on update: only editable when the branch's format
    // is NONE (manual entry). When a format is configured the id is
    // auto-generated once (on create, or here when finalizing an order that
    // never got one) and is otherwise immutable. Purpose follows the effective
    // status (a quote uses the QUOTATION format + counter).
    const isQuoteUpd = effectiveStatus === OrderStatus.QUOTE;
    const externalIdPurposeUpd = isQuoteUpd
      ? ExternalIdPurpose.QUOTATION
      : ExternalIdPurpose.ORDER;
    const externalIdFormatUpd = branchId
      ? await this.externalIdService.getConfiguredFormat(
          tenantId,
          branchId,
          externalIdPurposeUpd,
        )
      : ExternalIdFormat.NONE;
    const externalIdIsManualUpd = externalIdFormatUpd === ExternalIdFormat.NONE;
    // Manual value supplied in this patch (undefined = not touched).
    const manualExternalIdUpd =
      dto.externalOrderId !== undefined
        ? dto.externalOrderId.trim() || null
        : undefined;
    if (branchId && externalIdIsManualUpd) {
      const effectiveExternalId =
        manualExternalIdUpd !== undefined
          ? manualExternalIdUpd
          : (existing?.externalOrderId ?? null);
      if (
        (effectiveStatus === OrderStatus.ORDER ||
          effectiveStatus === OrderStatus.QUOTE) &&
        !effectiveExternalId
      ) {
        throw new ExternalOrderIdRequiredException(isQuoteUpd);
      }
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      // Resolve the external-id value to persist (undefined = leave untouched).
      let externalOrderIdUpdate: string | null | undefined;
      if (branchId) {
        if (externalIdIsManualUpd) {
          externalOrderIdUpdate = manualExternalIdUpd;
          if (externalOrderIdUpdate) {
            const dup = await tx.order.findFirst({
              where: {
                branchId,
                externalOrderId: externalOrderIdUpdate,
                deletedAt: null,
                id: { not: id },
              },
              select: { id: true },
            });
            if (dup) {
              throw new DuplicateExternalOrderIdException(
                externalOrderIdUpdate,
              );
            }
          }
        } else if (!existing?.externalOrderId) {
          // Configured format but the order never got an id (e.g. created as a
          // DRAFT before a format was set) — mint one now, atomically.
          const branchRow = await tx.branch.findUnique({
            where: { id: branchId },
            select: { shortName: true },
          });
          externalOrderIdUpdate = await this.externalIdService.generateInTx(
            tx,
            tenantId,
            branchId,
            externalIdPurposeUpd,
            externalIdFormatUpd,
            branchRow?.shortName ?? '',
          );
        }
      }

      // Flipping an existing order to APPOINTMENT without a linked lifecycle
      // record yet — create + link one (initial status NEW) in the same tx.
      const appointmentId =
        effectiveStatus === OrderStatus.APPOINTMENT &&
        !existing?.appointmentId &&
        appointmentType
          ? await this.appointmentService.createInTx(
              tx,
              tenantId,
              branchId,
              personId,
              { appointmentType },
            )
          : undefined;

      await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          updatedBy: personId,
          appointmentId,
          externalOrderId: externalOrderIdUpdate,
          // Recompute only when the payment ledger is part of this patch;
          // leave the stored status untouched otherwise.
          paymentStatus: dto.payments !== undefined ? paymentStatus : undefined,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
          orderType: dto.orderType,
          billingType: dto.billingType,
          isUrgentBill: dto.isUrgentBill,
          isBillGenerated: dto.isBillGenerated,
          orderNotes: dto.orderNotes,
          orderTime: dto.orderTime,
          // Replace the billing sub-form when provided; leave untouched otherwise.
          billingDetails:
            dto.billingDetails !== undefined
              ? (dto.billingDetails as Prisma.InputJsonValue)
              : undefined,
          quotationStatus: dto.quotationStatus,
          quotationValidTill: dto.quotationValidTill
            ? new Date(dto.quotationValidTill)
            : undefined,
          // Update the appointment time from the scheduled section / top-level
          // field (leave untouched when none supplied). Set the type per section
          // when status is in the patch; clear it when leaving APPOINTMENT.
          appointmentAt: sectionAppt ? new Date(sectionAppt) : undefined,
          appointmentType:
            dto.status === undefined
              ? undefined
              : dto.status === OrderStatus.APPOINTMENT
                ? (appointmentType ?? AppointmentType.DIAGNOSTIC)
                : null,
          referredByDoctorId: dto.referredByDoctorId,
          referralPanelId: dto.referralPanelId,
          b2bClient: dto.b2bClient,
          internalReferralId: dto.internalReferralId,
          externalReferralId: dto.externalReferralId,
          branchLabTestListId: dto.branchLabTestListId,
          branchLabPanelListId: dto.branchLabPanelListId,
        },
      });

      if (dto.items !== undefined) {
        await tx.orderItem.updateMany({
          where: { orderId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        if (dto.items.length) {
          const itemPrices = await this.loadItemUnitPrices(
            tenantId,
            branchId,
            dto.items,
          );
          await tx.orderItem.createMany({
            data: dto.items.map((i) => ({
              tenantId,
              branchId,
              orderId: id,
              branchLabTestId: i.branchLabTestId ?? null,
              branchLabPanelId: i.branchLabPanelId ?? null,
              direct: i.direct ?? null,
              unitPrice:
                itemPrices.get(i.branchLabTestId ?? i.branchLabPanelId ?? '') ??
                0,
              discount: i.discount ?? 0,
              outsourceCenterId: i.outsourceCenterId ?? null,
            })),
          });
        }
      }

      if (dto.diagnostics) {
        const data = this.diagnosticsData(
          dto.diagnostics,
          tenantId,
          branchId,
          id,
        );
        await tx.orderDiagnostics.upsert({
          where: { orderId: id },
          create: data,
          update: this.stripKeys(data),
        });
      }
      if (dto.opd) {
        const data = this.opdData(dto.opd, tenantId, branchId, id);
        await tx.orderOpd.upsert({
          where: { orderId: id },
          create: data,
          update: this.stripKeys(data),
        });
      }
      if (dto.radiology) {
        const data = this.radiologyData(dto.radiology, tenantId, branchId, id);
        await tx.orderRadiology.upsert({
          where: { orderId: id },
          create: data,
          update: this.stripKeys(data),
        });
      }

      // Replace the payment ledger wholesale when provided: soft-delete the
      // current rows and recreate from the patch (mirrors the item-set replace).
      // Safe to soft-delete + recreate — payment_details has no child unique key.
      if (dto.payments !== undefined) {
        await tx.paymentDetails.updateMany({
          where: { orderId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        if (dto.payments.length) {
          await tx.paymentDetails.createMany({
            data: dto.payments.map((p) => ({
              tenantId,
              branchId,
              orderId: id,
              ...p,
              paymentDate: p.paymentDate ? new Date(p.paymentDate) : null,
            })),
          });
        }
      }

      // Re-point the phlebotomist slot reservation when the booking changed
      // (reschedule / phlebotomist swap / home-visit toggle / status flip). Skip
      // when nothing about the booking changed so we don't re-validate (and
      // possibly reject) an untouched past appointment.
      if (!reservationUnchanged) {
        if (oldReservation) {
          await this.slotReservation.releaseInTx(
            tx,
            tenantId,
            oldReservation.branchId,
            oldReservation.phlebotomistId,
            oldReservation.at,
          );
        }
        if (newReservation) {
          await this.slotReservation.reserveInTx(
            tx,
            tenantId,
            newReservation.branchId,
            newReservation.phlebotomistId,
            newReservation.at,
          );
        }
      }

      // Generate accession samples once the order is confirmed as a diagnostic
      // order (e.g. a DRAFT/QUOTE flipped to ORDER/APPOINTMENT). Idempotent —
      // skips if this order already has samples.
      const hasDiagnostics = Boolean(dto.diagnostics ?? existing?.diagnostics);
      if (this.shouldGenerateSamples(effectiveStatus, hasDiagnostics)) {
        await this.accessionSamples.generateForOrderInTx(
          tx,
          tenantId,
          branchId,
          personId,
          id,
        );
      }
      // Create the home-visit Collection Schedule record if this update confirms a
      // home-visit order (e.g. DRAFT → ORDER/APPOINTMENT). Idempotent + guarded, so
      // it is a no-op for an order that already has a collection or isn't a home visit.
      await this.homeVisitCollections.createForOrderInTx(
        tx,
        tenantId,
        branchId,
        personId,
        id,
      );

      // Cross-order settlement — applied only on the TRANSITION into ORDER (e.g.
      // a draft finalized to ORDER), never on re-saving an already-ORDER order,
      // so the cleared amount is settled exactly once.
      if (
        existing?.status !== OrderStatus.ORDER &&
        effectiveStatus === OrderStatus.ORDER &&
        branchId &&
        existing?.patientId &&
        (dto.previousDuesCleared ?? 0) > 0
      ) {
        await this.settlePreviousDuesInTx(
          tx,
          tenantId,
          existing.patientId,
          dto.previousDuesCleared ?? 0,
          id,
          existing.orderCode,
          this.settlementPaymentMode(dto.payments),
          dto.orderDate ? new Date(dto.orderDate) : new Date(),
        );
      }
    });

    return this.findById(id, tenantId);
  }

  /**
   * Mark an order item's sample as collected. Idempotent — if the item is
   * already collected the original `collectedAt`/`collectedBy` are preserved.
   * Both the order and the item are validated against the caller's tenant first.
   *
   * Beyond the order-item `collectedAt` flag, this also drives the real accession
   * sample lifecycle: the item's linked `AccessionSample`(s) still in a
   * collectable status are transitioned to `COLLECTED` (with a barcode when
   * `opts.print` is set), and — because a sample is one physical tube shared by
   * several tests — every sibling order item on a transitioned sample is stamped
   * collected too (`AccessionSampleService.collectForOrderItemInTx`). Both writes
   * share one `withTenant` transaction so they commit atomically under the same
   * RLS tenant context. Safe no-op when the order has no samples yet (e.g. a
   * DRAFT / non-diagnostic order): only `collectedAt` is set.
   * @param orderId order the item belongs to
   * @param itemId order item id
   * @param tenantId tenant scope (from JWT)
   * @param actorId acting person id (recorded as `collectedBy`), may be null
   * @param opts `print` also assigns a barcode to the collected sample(s)
   * @returns the fully-composed order after the update
   * @throws OrderNotFoundException / OrderItemNotFoundException
   */
  async collectItem(
    orderId: string,
    itemId: string,
    tenantId: string,
    actorId: string | null,
    opts: { print?: boolean } = {},
  ): Promise<OrderWithRelations> {
    await this.findById(orderId, tenantId);
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId, tenantId, deletedAt: null },
      select: { id: true, collectedAt: true },
    });
    if (!item) {
      throw new OrderItemNotFoundException(orderId, itemId);
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      // Guard only the order-item stamp; the accession bridge runs regardless
      // (its own status filter is idempotent), otherwise a sample shared with an
      // already-collected sibling would be left stuck at NEW.
      if (!item.collectedAt) {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { collectedAt: new Date(), collectedBy: actorId },
        });
      }
      await this.accessionSamples.collectForOrderItemInTx(
        tx,
        tenantId,
        actorId,
        itemId,
        { print: !!opts.print },
      );
    });
    return this.findById(orderId, tenantId);
  }

  /**
   * Cancel an order — set `status = CANCELLED` (terminal). Allowed regardless of
   * payments already collected; no refund handling this phase. The order (and its
   * payment ledger) are preserved, unlike `remove`.
   * @param id order id
   * @param tenantId tenant scope
   * @param actorId acting person id (recorded as `updatedBy`), may be null
   * @returns the fully-composed order after cancellation
   * @throws OrderNotFoundException if missing/soft-deleted/other tenant
   * @throws OrderAlreadyCancelledException if already cancelled
   */
  async cancel(
    id: string,
    tenantId: string,
    actorId: string | null,
  ): Promise<OrderWithRelations> {
    const existing = await this.findById(id, tenantId);
    if (existing.status === OrderStatus.CANCELLED) {
      throw new OrderAlreadyCancelledException(id);
    }
    // Booking context for releasing the phlebotomist slot + cancelling the linked
    // appointment lifecycle record.
    const booking = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        branchId: true,
        status: true,
        appointmentId: true,
        appointment: { select: { status: true, branchId: true } },
        diagnostics: {
          select: {
            isHomeVisit: true,
            phlebotomistId: true,
            collectionAt: true,
            appointmentAt: true,
          },
        },
      },
    });
    // The slot held by this booking (null if its appointment already released it).
    // Computed from the pre-cancel state; released below whether or not an
    // appointment is linked (a walk-in ORDER holds a slot with no appointment).
    const reservation =
      booking?.appointment?.status === AppointmentStatus.CANCELLED
        ? null
        : this.homeVisitReservation(
            booking?.status,
            booking?.branchId ?? null,
            booking?.diagnostics,
          );
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED, updatedBy: actorId },
      });
      // Cancel the linked appointment too (+ history) so a cancelled order no
      // longer occupies a phlebotomist slot.
      if (
        booking?.appointmentId &&
        booking.appointment?.status !== AppointmentStatus.CANCELLED
      ) {
        await tx.appointment.update({
          where: { id: booking.appointmentId },
          data: { status: AppointmentStatus.CANCELLED, updatedBy: actorId },
        });
        await tx.appointmentStatusHistory.create({
          data: {
            tenantId,
            branchId: booking.appointment?.branchId ?? booking.branchId,
            appointmentId: booking.appointmentId,
            status: AppointmentStatus.CANCELLED,
            notes: 'Order cancelled',
            changedBy: actorId,
          },
        });
      }
      // Release the phlebotomist slot the (now-cancelled) order held.
      if (reservation) {
        await this.slotReservation.releaseInTx(
          tx,
          tenantId,
          reservation.branchId,
          reservation.phlebotomistId,
          reservation.at,
        );
      }
    });
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete an order and cascade soft-delete its items, sections, and
   * payments, in one transaction.
   * @param id order id
   * @param tenantId tenant scope
   * @throws OrderNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<Order> {
    await this.findById(id, tenantId);
    // Booking context so a soft-deleted order releases the phlebotomist slot it
    // held (unless its appointment was already cancelled — that already released).
    const booking = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        branchId: true,
        status: true,
        appointment: { select: { status: true } },
        diagnostics: {
          select: {
            isHomeVisit: true,
            phlebotomistId: true,
            collectionAt: true,
            appointmentAt: true,
          },
        },
      },
    });
    const reservation =
      booking?.appointment?.status === AppointmentStatus.CANCELLED
        ? null
        : this.homeVisitReservation(
            booking?.status,
            booking?.branchId ?? null,
            booking?.diagnostics,
          );
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = { orderId: id, tenantId, deletedAt: null };
      await Promise.all([
        tx.orderItem.updateMany({ where, data: { deletedAt: now } }),
        tx.orderDiagnostics.updateMany({ where, data: { deletedAt: now } }),
        tx.orderOpd.updateMany({ where, data: { deletedAt: now } }),
        tx.orderRadiology.updateMany({ where, data: { deletedAt: now } }),
        tx.paymentDetails.updateMany({ where, data: { deletedAt: now } }),
        tx.homeVisitCollection.updateMany({ where, data: { deletedAt: now } }),
      ]);
      if (reservation) {
        await this.slotReservation.releaseInTx(
          tx,
          tenantId,
          reservation.branchId,
          reservation.phlebotomistId,
          reservation.at,
        );
      }
      return tx.order.update({ where: { id }, data: { deletedAt: now } });
    });
  }

  // ── Reference validation ────────────────────────────────────────────────────

  /**
   * Assert the patient exists (active, same tenant).
   * @throws OrderPatientNotFoundException if it doesn't resolve
   */
  private async assertPatient(
    tenantId: string,
    patientId: string,
  ): Promise<void> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new OrderPatientNotFoundException(patientId);
    }
  }

  /**
   * Validate every order item: exactly one of test id / panel id / direct entry,
   * and that each referenced branch lab test / panel is an active row in the
   * caller's tenant (the `direct` free-text value needs no reference check).
   * @throws InvalidOrderItemException / OrderBranchLabTestNotFoundException /
   *         OrderBranchLabPanelNotFoundException
   */
  private async assertItems(
    tenantId: string,
    items?: OrderItemDto[],
  ): Promise<void> {
    if (!items?.length) {
      return;
    }
    const testIds: string[] = [];
    const panelIds: string[] = [];
    for (const item of items) {
      const sources = [
        Boolean(item.branchLabTestId),
        Boolean(item.branchLabPanelId),
        Boolean(item.direct),
      ].filter(Boolean).length;
      if (sources !== 1) {
        throw new InvalidOrderItemException(
          sources === 0
            ? 'none of branchLabTestId, branchLabPanelId or direct was provided'
            : 'more than one of branchLabTestId, branchLabPanelId or direct was provided',
        );
      }
      if (item.branchLabTestId) testIds.push(item.branchLabTestId);
      if (item.branchLabPanelId) panelIds.push(item.branchLabPanelId);
    }
    await Promise.all([
      this.assertBranchLabTests(tenantId, testIds),
      this.assertBranchLabPanels(tenantId, panelIds),
    ]);
    await Promise.all(
      items
        .filter((item) => item.outsourceCenterId)
        .map((item) => this.assertOutsourceCenter(tenantId, item)),
    );
  }

  /**
   * Validate an item's chosen outsource center: must be an active center in
   * this tenant, and configured to handle this item's specific test/panel
   * (`OutsourceCenter.labTestId`/`labPanelId`, resolved through
   * `BranchLabTest.sourceLabTestId`/`BranchLabPanel.sourceLabPanelId` since
   * order items reference the branch-level catalogue snapshot, not the
   * tenant-level master row `OutsourceCenter` points to).
   * @throws OrderOutsourceCenterNotFoundException / OrderOutsourceCenterNotEligibleException
   */
  private async assertOutsourceCenter(
    tenantId: string,
    item: OrderItemDto,
  ): Promise<void> {
    const outsourceCenterId = item.outsourceCenterId!;
    const center = await this.prisma.outsourceCenter.findFirst({
      where: {
        id: outsourceCenterId,
        tenantId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, labTestId: true, labPanelId: true },
    });
    if (!center) {
      throw new OrderOutsourceCenterNotFoundException(outsourceCenterId);
    }

    let sourceLabTestId: string | null = null;
    let sourceLabPanelId: string | null = null;
    if (item.branchLabTestId) {
      const branchLabTest = await this.prisma.branchLabTest.findFirst({
        where: { id: item.branchLabTestId, tenantId, deletedAt: null },
        select: { sourceLabTestId: true },
      });
      sourceLabTestId = branchLabTest?.sourceLabTestId ?? null;
    } else if (item.branchLabPanelId) {
      const branchLabPanel = await this.prisma.branchLabPanel.findFirst({
        where: { id: item.branchLabPanelId, tenantId, deletedAt: null },
        select: { sourceLabPanelId: true },
      });
      sourceLabPanelId = branchLabPanel?.sourceLabPanelId ?? null;
    }

    const eligible =
      (sourceLabTestId && center.labTestId === sourceLabTestId) ||
      (sourceLabPanelId && center.labPanelId === sourceLabPanelId);
    if (!eligible) {
      throw new OrderOutsourceCenterNotEligibleException(
        outsourceCenterId,
        item.branchLabTestId ?? item.branchLabPanelId ?? 'direct',
      );
    }
  }

  /**
   * Validate the order-level referral references: referral doctor + referral
   * panel, plus the internal / external referral records — all tenant-scoped.
   * Only supplied ids are checked.
   * @throws OrderReferralDoctorNotFoundException /
   *         OrderReferralPanelNotFoundException /
   *         OrderInternalReferralNotFoundException /
   *         OrderExternalReferralNotFoundException
   */
  private async assertReferrals(
    tenantId: string,
    dto: CreateOrderDto | UpdateOrderDto,
  ): Promise<void> {
    if (dto.referredByDoctorId) {
      await this.assertReferralDoctor(tenantId, dto.referredByDoctorId);
    }
    if (dto.referralPanelId) {
      await this.assertReferralPanel(tenantId, dto.referralPanelId);
    }
    if (dto.internalReferralId) {
      await this.assertInternalReferral(tenantId, dto.internalReferralId);
    }
    if (dto.externalReferralId) {
      await this.assertExternalReferral(tenantId, dto.externalReferralId);
    }
  }

  /** @throws OrderReferralDoctorNotFoundException if the referral doctor doesn't resolve. */
  private async assertReferralDoctor(
    tenantId: string,
    referredByDoctorId: string,
  ): Promise<void> {
    const doctor = await this.prisma.referralDoctor.findFirst({
      where: { id: referredByDoctorId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!doctor) {
      throw new OrderReferralDoctorNotFoundException(referredByDoctorId);
    }
  }

  /** @throws OrderReferralPanelNotFoundException if the referral panel doesn't resolve. */
  private async assertReferralPanel(
    tenantId: string,
    referralPanelId: string,
  ): Promise<void> {
    const panel = await this.prisma.referralPanel.findFirst({
      where: { id: referralPanelId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!panel) {
      throw new OrderReferralPanelNotFoundException(referralPanelId);
    }
  }

  /** @throws OrderInternalReferralNotFoundException if it doesn't resolve. */
  private async assertInternalReferral(
    tenantId: string,
    internalReferralId: string,
  ): Promise<void> {
    const referral = await this.prisma.internalReferral.findFirst({
      where: { id: internalReferralId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!referral) {
      throw new OrderInternalReferralNotFoundException(internalReferralId);
    }
  }

  /** @throws OrderExternalReferralNotFoundException if it doesn't resolve. */
  private async assertExternalReferral(
    tenantId: string,
    externalReferralId: string,
  ): Promise<void> {
    const referral = await this.prisma.externalReferral.findFirst({
      where: { id: externalReferralId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!referral) {
      throw new OrderExternalReferralNotFoundException(externalReferralId);
    }
  }

  /**
   * Assert a person exists and is active. `Person` is platform-level (no tenant
   * filter). Reused for the radiology technician reference.
   * @throws OrderPersonNotFoundException if it doesn't resolve
   */
  private async assertPerson(field: string, personId: string): Promise<void> {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!person) {
      throw new OrderPersonNotFoundException(field, personId);
    }
  }

  /** @throws OrderBranchLabTestNotFoundException if any id is missing/foreign. */
  private async assertBranchLabTests(
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) {
      return;
    }
    const found = await this.prisma.branchLabTest.findMany({
      where: { id: { in: unique }, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const foundIds = new Set(found.map((r) => r.id));
      throw new OrderBranchLabTestNotFoundException(
        unique.filter((id) => !foundIds.has(id)),
      );
    }
  }

  /** @throws OrderBranchLabPanelNotFoundException if any id is missing/foreign. */
  private async assertBranchLabPanels(
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) {
      return;
    }
    const found = await this.prisma.branchLabPanel.findMany({
      where: { id: { in: unique }, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const foundIds = new Set(found.map((r) => r.id));
      throw new OrderBranchLabPanelNotFoundException(
        unique.filter((id) => !foundIds.has(id)),
      );
    }
  }

  /** Validate the diagnostics section's foreign refs. */
  private async assertDiagnostics(
    tenantId: string,
    d: OrderDiagnosticsDto,
  ): Promise<void> {
    if (d.diagnosticPanelId) {
      const panel = await this.prisma.labPanel.findFirst({
        where: { id: d.diagnosticPanelId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!panel) {
        throw new OrderDiagnosticPanelNotFoundException(d.diagnosticPanelId);
      }
    }
    if (d.phlebotomistId) {
      await this.assertPerson('phlebotomistId', d.phlebotomistId);
    }
  }

  /**
   * Validate the OPD section's consultant doctor + optional department and
   * category.
   */
  private async assertOpd(tenantId: string, opd: OrderOpdDto): Promise<void> {
    const doctor = await this.prisma.doctor.findFirst({
      where: {
        id: opd.doctorId,
        tenantId,
        deletedAt: null,
        doctorType: DoctorType.CONSULTANT,
      },
      select: { id: true },
    });
    if (!doctor) {
      throw new OrderConsultantDoctorNotFoundException(opd.doctorId);
    }
    if (opd.departmentId) {
      await this.assertDepartment(tenantId, opd.departmentId);
    }
    if (opd.categoryId) {
      await this.assertCategory(tenantId, opd.categoryId);
    }
  }

  /**
   * Validate the radiology section's radiologist (a staff `Person`) +
   * department/category refs.
   */
  private async assertRadiology(
    tenantId: string,
    r: OrderRadiologyDto,
  ): Promise<void> {
    await this.assertPerson('radiologistId', r.radiologistId);
    if (r.radiologistDepartmentId) {
      await this.assertDepartment(tenantId, r.radiologistDepartmentId);
    }
    if (r.radiologistCategoryId) {
      await this.assertCategory(tenantId, r.radiologistCategoryId);
    }
    if (r.radiologyTechnicianId) {
      await this.assertPerson('radiologyTechnicianId', r.radiologyTechnicianId);
    }
  }

  /** @throws OrderDepartmentNotFoundException if the department doesn't resolve. */
  private async assertDepartment(
    tenantId: string,
    departmentId: string,
  ): Promise<void> {
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!dept) {
      throw new OrderDepartmentNotFoundException(departmentId);
    }
  }

  /** @throws OrderCategoryNotFoundException if the category doesn't resolve. */
  private async assertCategory(
    tenantId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      throw new OrderCategoryNotFoundException(categoryId);
    }
  }

  // ── Section data builders ─────────────────────────────────────────────────────

  /**
   * When an order is saved with status APPOINTMENT it must have exactly one
   * scheduled service section — a Diagnostic, OPD, or Radiology section carrying
   * an `appointmentAt`. The order's top-level `appointmentAt` + `appointmentType`
   * are derived from that section (see {@link resolveAppointment}).
   * @throws AppointmentSectionRequiredException when no section carries an
   *   appointment time
   */
  private assertAppointmentSection(
    status: OrderStatus | undefined,
    dto: {
      diagnostics?: OrderDiagnosticsDto;
      opd?: OrderOpdDto;
      radiology?: OrderRadiologyDto;
    },
  ): void {
    if (status !== OrderStatus.APPOINTMENT) {
      return;
    }
    const hasScheduledSection =
      Boolean(dto.diagnostics?.appointmentAt) ||
      Boolean(dto.opd?.appointmentAt) ||
      Boolean(dto.radiology?.appointmentAt);
    if (!hasScheduledSection) {
      throw new AppointmentSectionRequiredException();
    }
  }

  /**
   * Enforce everything a live (non-draft) order requires. Shared by new-order
   * creation and draft finalization so both perform identical checks. Operates
   * on the EFFECTIVE order — the incoming patch merged over the persisted draft
   * — so a draft can never be finalized while incomplete. A no-op for `DRAFT` /
   * `CANCELLED`, keeping drafts freely saveable.
   * @throws OrderRequiresItemsException / OrderHomeVisitPhlebotomistRequiredException /
   *         OrderHomeVisitSlotRequiredException
   */
  private assertFinalizedOrder(input: {
    status: OrderStatus | undefined;
    itemCount: number;
    diagnostics?: {
      isHomeVisit: boolean;
      phlebotomistId: string | null;
      collectionAt: Date | null;
    } | null;
  }): void {
    const { status } = input;
    if (
      status !== OrderStatus.ORDER &&
      status !== OrderStatus.QUOTE &&
      status !== OrderStatus.APPOINTMENT
    ) {
      return;
    }
    if (input.itemCount < 1) {
      throw new OrderRequiresItemsException();
    }
    const d = input.diagnostics;
    if (d?.isHomeVisit) {
      if (!d.phlebotomistId) {
        throw new OrderHomeVisitPhlebotomistRequiredException();
      }
      if (!d.collectionAt) {
        throw new OrderHomeVisitSlotRequiredException();
      }
    }
  }

  /**
   * The appointment type implied by whichever service section is present on the
   * payload (Diagnostic → OPD → Radiology precedence). Returns null when no
   * section is present.
   */
  private sectionAppointmentType(dto: {
    diagnostics?: OrderDiagnosticsDto;
    opd?: OrderOpdDto;
    radiology?: OrderRadiologyDto;
  }): AppointmentType | null {
    if (dto.diagnostics) return AppointmentType.DIAGNOSTIC;
    if (dto.opd) return AppointmentType.OPD;
    if (dto.radiology) return AppointmentType.RADIOLOGY;
    return null;
  }

  /**
   * Derive the order's top-level `appointmentAt` + `appointmentType` for a create.
   * For an APPOINTMENT order these come from the scheduled section (Diagnostic →
   * OPD → Radiology precedence); otherwise fall back to any explicit top-level
   * `appointmentAt` and leave the type unset.
   */
  private resolveAppointment(dto: {
    status?: OrderStatus;
    appointmentAt?: string;
    diagnostics?: OrderDiagnosticsDto;
    opd?: OrderOpdDto;
    radiology?: OrderRadiologyDto;
  }): { appointmentAt: Date | null; appointmentType: AppointmentType | null } {
    if (dto.status === OrderStatus.APPOINTMENT) {
      if (dto.diagnostics?.appointmentAt) {
        return {
          appointmentAt: new Date(dto.diagnostics.appointmentAt),
          appointmentType: AppointmentType.DIAGNOSTIC,
        };
      }
      if (dto.opd?.appointmentAt) {
        return {
          appointmentAt: new Date(dto.opd.appointmentAt),
          appointmentType: AppointmentType.OPD,
        };
      }
      if (dto.radiology?.appointmentAt) {
        return {
          appointmentAt: new Date(dto.radiology.appointmentAt),
          appointmentType: AppointmentType.RADIOLOGY,
        };
      }
    }
    return {
      appointmentAt: dto.appointmentAt ? new Date(dto.appointmentAt) : null,
      appointmentType: null,
    };
  }

  private diagnosticsData(
    d: OrderDiagnosticsDto,
    tenantId: string,
    branchId: string | null,
    orderId: string,
  ): Prisma.OrderDiagnosticsUncheckedCreateInput {
    return {
      tenantId,
      branchId,
      orderId,
      prescriptionUrl: d.prescriptionUrl ?? null,
      diagnosticPanelId: d.diagnosticPanelId ?? null,
      sampleSource: d.sampleSource ?? undefined,
      sampleCollectionCharges: d.sampleCollectionCharges ?? undefined,
      logisticsSuppliedBy: d.logisticsSuppliedBy ?? null,
      isFasting: d.isFasting ?? undefined,
      isHomeVisit: d.isHomeVisit ?? undefined,
      collectionAddress: d.collectionAddress ?? null,
      phlebotomistId: d.phlebotomistId ?? null,
      visitCharges: d.visitCharges ?? undefined,
      collectionAt: d.collectionAt ? new Date(d.collectionAt) : null,
      appointmentAt: d.appointmentAt ? new Date(d.appointmentAt) : null,
      geoLocation: d.geoLocation ?? null,
    };
  }

  /** Build the create-data for the OPD section. */
  private opdData(
    opd: OrderOpdDto,
    tenantId: string,
    branchId: string | null,
    orderId: string,
  ): Prisma.OrderOpdUncheckedCreateInput {
    return {
      tenantId,
      branchId,
      orderId,
      departmentId: opd.departmentId ?? null,
      categoryId: opd.categoryId ?? null,
      doctorId: opd.doctorId,
      consultantType: opd.consultantType ?? null,
      visitType: opd.visitType ?? null,
      consultationAt: opd.consultationAt ? new Date(opd.consultationAt) : null,
      appointmentAt: opd.appointmentAt ? new Date(opd.appointmentAt) : null,
    };
  }

  /** Build the create-data for the radiology section. */
  private radiologyData(
    r: OrderRadiologyDto,
    tenantId: string,
    branchId: string | null,
    orderId: string,
  ): Prisma.OrderRadiologyUncheckedCreateInput {
    return {
      tenantId,
      branchId,
      orderId,
      radiologistId: r.radiologistId,
      radiologistDepartmentId: r.radiologistDepartmentId ?? null,
      radiologistCategoryId: r.radiologistCategoryId ?? null,
      radiologyTechnicianId: r.radiologyTechnicianId ?? null,
      appointmentAt: r.appointmentAt ? new Date(r.appointmentAt) : null,
    };
  }

  /** Strip the identity keys that must not change on a section upsert-update. */
  private stripKeys<T extends { tenantId: string; orderId: string }>(
    data: T,
  ): Omit<T, 'tenantId' | 'orderId'> {
    const rest = { ...data };
    delete (rest as Partial<T>).tenantId;
    delete (rest as Partial<T>).orderId;
    return rest;
  }

  /** Count active items per order, keyed by order id (batched; no N+1). */
  private async countItemsByOrder(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, { total: number; collected: number }>> {
    const map = new Map<string, { total: number; collected: number }>();
    if (!ids.length) {
      return map;
    }
    const [grouped, collectedGrouped] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['orderId'],
        where: { orderId: { in: ids }, tenantId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['orderId'],
        where: {
          orderId: { in: ids },
          tenantId,
          deletedAt: null,
          collectedAt: { not: null },
        },
        _count: { _all: true },
      }),
    ]);
    for (const g of grouped) {
      map.set(g.orderId, { total: g._count._all, collected: 0 });
    }
    for (const g of collectedGrouped) {
      const entry = map.get(g.orderId);
      if (entry) entry.collected = g._count._all;
    }
    return map;
  }

  /** Map an order-code unique-constraint violation (P2002) to a typed 409. */
  private rethrowConflict(e: unknown): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new OrderCodeConflictException('');
    }
  }
}
