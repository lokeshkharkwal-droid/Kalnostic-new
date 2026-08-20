import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  DiscountMode,
  DoctorType,
  ExternalIdFormat,
  ExternalIdPurpose,
  InvoicePaymentStatus,
  Order,
  OrderDateType,
  OrderStatus,
  PaymentEntryType,
  PaymentMode,
  PaymentStatus,
  Prisma,
  QuotationStatus,
  RepeatIntervalUnit,
  SampleSource,
  SettlementStatus,
  TransferKind,
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
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { BillingDetailsDto } from './dto/billing-details.dto';
import { OrderDiagnosticsDto } from './dto/order-diagnostics.dto';
import { OrderOpdDto } from './dto/order-opd.dto';
import { OrderRadiologyDto } from './dto/order-radiology.dto';
import {
  ORDER_INCLUDE,
  ORDER_LIST_INCLUDE,
  OrderListRow,
  OrderWithRelations,
  BILLING_ORDER_INCLUDE,
  BillingOrder,
  BillingRecordRow,
  BillingSummary,
  BillingSummaryByUserRow,
  BillingGroupRow,
  derivePaymentStatus,
  computeEffectivePaid,
  deriveRefundStatus,
} from './entities/order.entity';
import { BillingGroupBy } from './dto/billing-grouped-query.dto';
import { BillingDimension } from './dto/billing-query.dto';

/**
 * Which Finance report is being served. `billing` = invoiced view (`paid` is the
 * full ledger paid). `collection` = realization view (`paid` is physical receipts
 * only — the five payment modes, excluding WALLET — and the dataset is scoped to
 * orders with a collected payment). The payment-mode breakdown is returned for
 * both; only Collection displays it.
 */
type BillingReport =
  | 'billing'
  | 'collection'
  | 'outstanding'
  | 'refund'
  | 'cancel';

/**
 * Order-level (or line-level) money figures, whole rupees. The payment-mode
 * fields bucket collected `paidAmount` by mode (Collection mapping:
 * `CASH`→cash, `UPI`→upi, `BANK_TRANSFER`→bankTransfer, `CARD`→debitCard,
 * `CREDIT`→creditCard; `WALLET` is excluded from the five). For a `collection`
 * report `paid === cash + upi + bankTransfer + debitCard + creditCard`.
 */
interface BillingFigures {
  gross: number;
  discount: number;
  net: number;
  paid: number;
  due: number;
  tds: number;
  cash: number;
  upi: number;
  bankTransfer: number;
  debitCard: number;
  creditCard: number;
  /** Σ of REFUND ledger rows' `refundAmount` (powers the Refund report). */
  refundAmount: number;
  /** The order's `cancellationCharge` (powers the Cancel report). */
  cancelAmount: number;
}

/** One order line with its allocated share of the order-level money. */
interface AllocatedBillingLine extends BillingFigures {
  branchLabTestId: string | null;
  branchLabPanelId: string | null;
  testName: string | null;
  panelName: string | null;
  /** Stable per-test / per-panel identity (dedupes copies across pricing lists). */
  testCode: string | null;
  panelCode: string | null;
  /** Master catalogue ids — used to fall back to the master classification. */
  sourceLabTestId: string | null;
  sourceLabPanelId: string | null;
  /** Classification as stored on the BRANCH row (often null; master is the fallback). */
  departmentId: string | null;
  categoryId: string | null;
  subCategoryId: string | null;
}

/**
 * Master-catalogue classification, keyed by a source `LabTest`/`LabPanel` id — used
 * to fall back when the BRANCH test/panel row carries no department/category/
 * sub-category (the mapping lives on the master catalogue).
 */
type ClassificationFallback = Map<
  string,
  {
    departmentId: string | null;
    categoryId: string | null;
    subCategoryId: string | null;
  }
>;
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
  CancellationChargeExceedsPaidException,
  RefundExceedsRefundableException,
  NothingToRefundException,
  OrderCancellationNotAllowedException,
  RefundNotAllowedException,
  PartialRefundNotAllowedException,
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
  SourceQuotationInvalidException,
  QuotationNotExpiredException,
  QuotationDuplicationNotAllowedException,
  PreviousDuesNotClearedException,
  PreviousDuesOverpaymentException,
  FullPaymentRequiredException,
  PartialPaymentBelowMinimumException,
  DuplicateExternalOrderIdException,
  OrderDiscountNotAllowedException,
  OrderDiscountOutOfRangeException,
  LineItemDiscountNotAllowedException,
  LineItemDiscountOutOfRangeException,
  TdsNotApplicableException,
  TdsOutOfRangeException,
  PartialBillingNotAllowedForDiscountedOrderException,
  OrderCancellationByOtherUserNotAllowedException,
  QuotationEditByOtherUserNotAllowedException,
  BillCopyPrintNotAllowedForUnpaidException,
  AppointmentPaymentRequiredException,
  PaymentWithoutBillGeneratedException,
} from './exceptions/order.exceptions';
import type { RegistrationSetting } from '@prisma/client';
// Reused so an inline order-payment overpayment raises the SAME
// `PAYMENT_OVERPAYMENT` error the standalone `POST /payments` guard does. These
// import exception classes (not services), so rule #3 is not violated.
import {
  PaymentOverpaymentException,
  PaymentCollectionByOtherUserNotAllowedException,
} from '../payment-details/exceptions/payment-details.exceptions';

/**
 * The minimal payment shape the discount/TDS + partial-billing validators read —
 * satisfied by both an inline `OrderPaymentDto` and a Prisma `paymentDetails`
 * select of the same fields.
 */
type DiscountTdsPaymentRow = {
  netAmount?: number | null;
  paidAmount?: number | null;
  orderDiscount?: number | null;
  tdsDeduction?: number | null;
};

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
    // Generate Bill = No: the order records no money (the FE also disables the
    // whole Payment Details section). Reject any positive paid amount as defence
    // in depth.
    if (dto.isBillGenerated === false && payPaid > 0) {
      throw new PaymentWithoutBillGeneratedException(payPaid);
    }
    // Generate Bill = No ⇒ the order is "completed" with nothing owed: its ledger
    // is zeroed (payable/net/paid = 0 → no dues) and its payment status is forced
    // to PAID (settled). The billing rules + previous-dues settlement below are all
    // skipped for it.
    const billNotGenerated = dto.isBillGenerated === false;
    const paymentStatus = billNotGenerated
      ? PaymentStatus.PAID
      : derivePaymentStatus(payNet, payPaid);

    // Snapshot each item's list unit price from its branch lab test/panel row so
    // the order's prices are stable even if the list is later re-priced (§B5).
    // Loaded before the billing rules so the discount/TDS checks (and the
    // partial-billing-of-discounted rule) can compute amounts from the
    // authoritative server-side prices rather than trusting the client.
    const itemPrices = await this.loadItemUnitPrices(
      tenantId,
      branchId,
      dto.items ?? [],
    );

    // Fetch the branch's Registration settings once (only when finalizing a real
    // order at a branch) and share it across every rule below.
    const needsBillingRules =
      dto.status === OrderStatus.ORDER && Boolean(branchId);
    const settings =
      needsBillingRules && branchId
        ? await this.registrationSettingsService.getForBranch(
            tenantId,
            branchId,
          )
        : null;
    const hasDiscount = this.orderHasDiscount(dto.items ?? [], dto.payments);

    // Enforce the branch's Previous-Dues + Partial-Billing rules (Registration
    // Settings → Charges & Deductions). Only bites when finalizing a real order
    // (`status = ORDER`) at a branch; DRAFT/QUOTE/APPOINTMENT are exempt. Also
    // skipped entirely when no bill is generated — there is nothing to bill, so
    // the previous-dues / partial-billing / discount gates must not block it.
    if (!billNotGenerated) {
      await this.assertBillingRules({
        tenantId,
        branchId,
        status: dto.status,
        patientId: dto.patientId,
        payments: dto.payments,
        previousDuesCleared: dto.previousDuesCleared ?? 0,
        settings,
        hasDiscount,
      });

      // Enforce the branch's TDS & Discount rules (allow-flags, discount mode,
      // and min/max percentages) against the server-side item prices.
      this.assertDiscountAndTdsRules({
        status: dto.status,
        branchId,
        settings,
        items: dto.items ?? [],
        payments: dto.payments,
        itemPrices,
      });
    }

    // Appointment check-in payment gating (Registration Settings → Appointment).
    // The two flags are mutually exclusive (enforced on save): "check-in for
    // paid only" blocks an unpaid/partial appointment; "allow progress of
    // unpaid/partial" (or neither) permits it. Only bites when creating an
    // APPOINTMENT-status order at a branch.
    if (dto.status === OrderStatus.APPOINTMENT && branchId) {
      const apptSettings =
        settings ??
        (await this.registrationSettingsService.getForBranch(
          tenantId,
          branchId,
        ));
      if (
        apptSettings.Appointment_AllowCheckInForPaidAppointmentsOnly &&
        paymentStatus !== PaymentStatus.PAID
      ) {
        throw new AppointmentPaymentRequiredException(payNet, payPaid);
      }
    }

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
    // A manual external Order/Quote id is optional: the internal `orderCode` is
    // always generated below, independent of the external id. When a value is
    // supplied (NONE format) it is kept and uniqueness-checked; otherwise the
    // external id is simply left null.
    const manualExternalId = dto.externalOrderId?.trim() || null;

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
            orderDateType: this.classifyOrderDate(dto.orderDate),
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
            // Link back to the source quote when this order is a conversion
            // (only kept for real conversions — see the CONVERTED flip below).
            sourceQuotationId:
              dto.sourceQuotationId && dto.status !== OrderStatus.QUOTE
                ? dto.sourceQuotationId
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
        // Quotation → order conversion: when this order was created from a quote
        // and is a real conversion (any status other than QUOTE), flip the source
        // quote to CONVERTED in the SAME transaction. Any failure above rolls this
        // back too, so a failed create never marks a quote converted. The quote
        // keeps status = QUOTE (so it stays on the Quotations screen) — only its
        // quotationStatus changes.
        if (dto.sourceQuotationId && dto.status !== OrderStatus.QUOTE) {
          const sourceQuote = await tx.order.findFirst({
            where: {
              id: dto.sourceQuotationId,
              tenantId,
              deletedAt: null,
              quotationStatus: { not: null },
            },
            select: { id: true },
          });
          if (!sourceQuote) {
            throw new SourceQuotationInvalidException(dto.sourceQuotationId);
          }
          await tx.order.update({
            where: { id: sourceQuote.id },
            data: {
              quotationStatus: QuotationStatus.CONVERTED,
              updatedBy: personId,
            },
          });
        }
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
              discountMode: i.discountMode ?? null,
              discountValue: i.discountValue ?? null,
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
              // Generate Bill = No ⇒ zero every money field except the gross
              // `totalAmount` (kept for visibility): payable/net/paid = 0 so the
              // order carries no due and reads as settled.
              ...(billNotGenerated
                ? {
                    orderDiscount: 0,
                    netDiscount: 0,
                    netAmount: 0,
                    payableAmount: 0,
                    paidAmount: 0,
                    remainingBalance: 0,
                    tdsDeduction: 0,
                  }
                : {}),
              paymentDate: p.paymentDate ? new Date(p.paymentDate) : null,
            })),
          });
        }
        // Cross-order settlement: an order created directly as ORDER is entering
        // the ORDER state now, so apply any amount collected toward previous dues
        // across the patient's outstanding orders (oldest first) in this same tx.
        // Skipped when no bill is generated (nothing is collected).
        if (
          dto.status === OrderStatus.ORDER &&
          branchId &&
          !billNotGenerated &&
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
    /** Pre-fetched branch settings — supplied by the caller to avoid a second
     *  fetch (falls back to loading them when omitted). */
    settings?: RegistrationSetting | null;
    /** Whether the order carries any discount (order-level or per-line) — gates
     *  the "Allow Partial Billing of Discounted Order" rule. */
    hasDiscount?: boolean;
  }): Promise<void> {
    const {
      tenantId,
      branchId,
      status,
      patientId,
      payments,
      previousDuesCleared,
      excludeOrderId,
      hasDiscount = false,
    } = params;
    if (status !== OrderStatus.ORDER || !branchId) return;

    const settings =
      params.settings ??
      (await this.registrationSettingsService.getForBranch(tenantId, branchId));

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
      } else if (
        hasDiscount &&
        !settings.ChargesAndDeductions_AllowPartialBillingOfDiscountedOrder
      ) {
        // Partial billing is on, but not for discounted orders — a discounted
        // order must still be paid in full.
        if (paid < net) {
          throw new PartialBillingNotAllowedForDiscountedOrderException(
            net,
            paid,
          );
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
   * Whether an order carries any discount — an order-level discount (on the
   * first payment row) or any per-line item discount. Used to gate the
   * "Allow Partial Billing of Discounted Order" rule.
   */
  private orderHasDiscount(
    items: OrderItemDto[],
    payments: DiscountTdsPaymentRow[] | undefined,
  ): boolean {
    const lineDiscount = items.reduce((s, i) => s + (i.discount ?? 0), 0);
    const orderDiscount = payments?.[0]?.orderDiscount ?? 0;
    return lineDiscount > 0 || orderDiscount > 0;
  }

  /**
   * Enforce the branch's **TDS & Discount** rules (Registration Settings →
   * Charges & Deductions) when finalizing a real order (`status = ORDER`) at a
   * branch. Everything is computed from the server-side `itemPrices` (never a
   * client-supplied net), mirroring the frontend gating so the API is secure
   * even if the UI is bypassed. DRAFT/QUOTE/APPOINTMENT are exempt.
   *
   * - **Order discount** (first payment row's `orderDiscount`): rejected when
   *   order-level discounts are disabled (Allow Discounts off, or the active
   *   discount mode is Line-only); otherwise its effective percentage of the
   *   items subtotal must fall within `[Minimum, Maximum] Discount %`.
   * - **Line-item discount** (per item): rejected when line discounts are
   *   disabled; otherwise each item's effective percentage of its price must
   *   fall within `[Minimum, Maximum] Line Item Discount %`.
   * - **TDS** (first payment row's `tdsDeduction`): rejected when TDS is not
   *   applicable; otherwise its effective percentage of the net amount must
   *   fall within `[Minimum, Maximum] TDS %`.
   *
   * A percentage bound applies only when a discount/TDS is actually applied
   * (amount > 0); a zero value is always allowed.
   *
   * @throws OrderDiscountNotAllowedException / OrderDiscountOutOfRangeException
   * @throws LineItemDiscountNotAllowedException / LineItemDiscountOutOfRangeException
   * @throws TdsNotApplicableException / TdsOutOfRangeException
   */
  private assertDiscountAndTdsRules(params: {
    status: OrderStatus | undefined;
    branchId: string | null;
    settings: RegistrationSetting | null;
    items: OrderItemDto[];
    payments: DiscountTdsPaymentRow[] | undefined;
    itemPrices: Map<string, number>;
  }): void {
    const { status, branchId, settings, items, payments, itemPrices } = params;
    if (status !== OrderStatus.ORDER || !branchId || !settings) return;

    // Small tolerance so a legitimately at-the-boundary percentage isn't
    // rejected by floating-point noise (e.g. 20.0000001% for a 20% max).
    const EPS = 0.01;

    // Resolve capabilities from the settings (mirror of the frontend logic).
    const anyModeSet =
      settings.ChargesAndDeductions_AllowOrderDiscountOnly ||
      settings.ChargesAndDeductions_AllowLineDiscountOnly ||
      settings.ChargesAndDeductions_AllowBothOrderAndLineDiscount;
    const orderModeOk =
      settings.ChargesAndDeductions_AllowBothOrderAndLineDiscount ||
      settings.ChargesAndDeductions_AllowOrderDiscountOnly ||
      !anyModeSet;
    const lineModeOk =
      settings.ChargesAndDeductions_AllowBothOrderAndLineDiscount ||
      settings.ChargesAndDeductions_AllowLineDiscountOnly ||
      !anyModeSet;
    const orderDiscountEnabled =
      settings.ChargesAndDeductions_AllowDiscounts && orderModeOk;
    const lineDiscountEnabled =
      settings.ChargesAndDeductions_AllowLineItemDiscount && lineModeOk;

    // ── Line-item discounts (also accumulates the items subtotal + line total
    //    used by the order-discount / TDS bases below). ──
    const minLine =
      settings.ChargesAndDeductions_MinimumLineItemDiscountPercent;
    const maxLine =
      settings.ChargesAndDeductions_MaximumLineItemDiscountPercent;
    let itemsGross = 0;
    let lineDiscountTotal = 0;
    for (const item of items) {
      const key = item.branchLabTestId ?? item.branchLabPanelId ?? '';
      const price = itemPrices.get(key) ?? 0;
      itemsGross += price;
      const discount = item.discount ?? 0;
      lineDiscountTotal += discount;
      if (discount <= 0) continue;
      if (!lineDiscountEnabled) throw new LineItemDiscountNotAllowedException();
      // Effective percentage: use the typed PERCENT value directly, else derive
      // it from the amount and the line's price. A discount on a zero-price
      // (e.g. direct) line with an AMOUNT mode can't be expressed as a %, so the
      // range check is skipped (the allow-flag above still applies).
      let pct: number | null = null;
      if (
        item.discountMode === DiscountMode.PERCENT &&
        item.discountValue != null
      ) {
        pct = item.discountValue;
      } else if (price > 0) {
        pct = (discount / price) * 100;
      }
      if (pct != null && (pct < minLine - EPS || pct > maxLine + EPS)) {
        throw new LineItemDiscountOutOfRangeException(
          minLine,
          maxLine,
          Math.round(pct * 100) / 100,
          key || item.direct || 'item',
        );
      }
    }

    // ── Order-level discount (first payment row) ──
    const orderDiscount = payments?.[0]?.orderDiscount ?? 0;
    if (orderDiscount > 0) {
      if (!orderDiscountEnabled) throw new OrderDiscountNotAllowedException();
      const minOrder = settings.ChargesAndDeductions_MinimumDiscountPercent;
      const maxOrder = settings.ChargesAndDeductions_MaximumDiscountPercent;
      // No positive base to compute a percentage against ⇒ a discount can't be
      // valid.
      if (itemsGross <= 0) throw new OrderDiscountNotAllowedException();
      const pct = (orderDiscount / itemsGross) * 100;
      if (pct < minOrder - EPS || pct > maxOrder + EPS) {
        throw new OrderDiscountOutOfRangeException(
          minOrder,
          maxOrder,
          Math.round(pct * 100) / 100,
        );
      }
    }

    // ── TDS (first payment row), computed against the net amount ──
    const tds = payments?.[0]?.tdsDeduction ?? 0;
    if (tds > 0) {
      if (!settings.ChargesAndDeductions_TdsApplicable) {
        throw new TdsNotApplicableException();
      }
      const minTds = settings.ChargesAndDeductions_MinimumTdsPercent;
      const maxTds = settings.ChargesAndDeductions_MaximumTdsPercent;
      const net = Math.max(itemsGross - lineDiscountTotal - orderDiscount, 0);
      if (net <= 0) throw new TdsOutOfRangeException(minTds, maxTds, 0);
      const pct = (tds / net) * 100;
      if (pct < minTds - EPS || pct > maxTds + EPS) {
        throw new TdsOutOfRangeException(
          minTds,
          maxTds,
          Math.round(pct * 100) / 100,
        );
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
    // Bill copies may be restricted to fully-paid orders (branch setting). Net −
    // effective-paid ≤ 0 means the balance is settled. Only guards `bill_print`;
    // TRF / order slip / quotation are unaffected. No branch → no settings → allow.
    if (type === 'bill_print' && order.branchId) {
      const settings = await this.registrationSettingsService.getForBranch(
        tenantId,
        order.branchId,
      );
      if (settings.BillingMenu_AllowBillCopyPrintForPaidBillingsOnly) {
        const net = order.payments.reduce((s, p) => s + p.netAmount, 0);
        const effectivePaid = computeEffectivePaid(
          order.payments.reduce((s, p) => s + p.paidAmount, 0),
          order.cancellationCharge,
          order.payments.reduce((s, p) => s + p.refundAmount, 0),
          order.payments.reduce((s, p) => s + p.refundCharge, 0),
        );
        if (net - effectivePaid > 0) {
          throw new BillCopyPrintNotAllowedForUnpaidException(id);
        }
      }
    }
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

  /**
   * Classify an order's date relative to server "today" (both compared as
   * DATE-only, matching the `orderDate @db.Date` column). Used to stamp
   * `Order.orderDateType` on create and whenever the order date changes:
   * `BACKTRACKED` when the order is dated in the past, `ADVANCE_DATED` when dated
   * in the future, `CURRENT` when it is today.
   * @param orderDate the order date as an ISO-8601 date string (`YYYY-MM-DD…`)
   * @returns the {@link OrderDateType} classification
   */
  private classifyOrderDate(orderDate: string): OrderDateType {
    const orderDay = new Date(orderDate).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (orderDay < today) return OrderDateType.BACKTRACKED;
    if (orderDay > today) return OrderDateType.ADVANCE_DATED;
    return OrderDateType.CURRENT;
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
  /**
   * Build the Prisma `where` for an order listing/aggregation from the shared
   * {@link ListOrdersDto} filter set. Extracted from {@link findAll} so the
   * detailed list, the Billing metric-card summary, and the user-wise summary
   * all filter identically (the cards must match the table). Also returns the
   * runtime quotation-validity context {@link findAll} needs to compute per-row
   * expiry (inert for non-quotation callers such as Billing).
   * @param query the filter DTO
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from the JWT profile); `query.branchId` wins
   * @returns the composed `where` plus the quotation validity value/unit/cutoff
   */
  private async buildOrderWhere(
    query: ListOrdersDto,
    tenantId: string,
    activeBranchId: string | null,
    opts?: { classificationCoarse?: boolean },
  ): Promise<{
    where: Prisma.OrderWhereInput;
    quotationValidityValue: number | null;
    quotationValidityUnit: RepeatIntervalUnit | null;
    quotationExpiryCutoff: Date | null;
  }> {
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

    // Multi-status filter (Billing scope) wins over the single-status filter.
    if (query.statuses?.length) {
      where.status = { in: query.statuses };
    } else if (query.status) {
      where.status = query.status;
    }
    // Scope to quotation-origin records (any non-null quotationStatus) so
    // converted quotes (now status = ORDER) stay on the Quotations screen. A
    // specific quotationStatus filter below overrides this broader scope.
    if (query.isQuotation && !query.quotationStatus) {
      where.quotationStatus = { not: null };
    }
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    // Payment-mode filter: the order has a collected payment (PAYMENT entry) via
    // this mode. Pushed to `and[]` so it composes with other payment filters.
    if (query.paymentMode) {
      and.push({
        payments: {
          some: {
            deletedAt: null,
            entryType: PaymentEntryType.PAYMENT,
            paymentMode: query.paymentMode,
          },
        },
      });
    }
    if (query.appointmentStatus) {
      where.appointment = { is: { status: query.appointmentStatus } };
    }
    if (query.orderType) where.orderType = query.orderType;
    if (query.billingType) where.billingType = query.billingType;
    if (query.patientId) where.patientId = query.patientId;
    if (query.userId) where.createdBy = query.userId;
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
    if (query.orderDateType) where.orderDateType = query.orderDateType;
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
    // Classification filters (department / category / sub-category). The exact id
    // frequently lives on the MASTER catalogue, not the branch copy, so a precise
    // Prisma match on the branch scalar alone would silently drop master-
    // classified orders. The billing/report path passes `classificationCoarse`:
    // the DB clause is relaxed to "has a classifiable line" (a superset) and the
    // exact, master-aware match is re-applied in-app in `loadBillingOrders`, so a
    // filtered report still reconciles (cards = Σ records = Σ groups). Other
    // callers (the order list) keep the precise branch-scalar match.
    const classificationCoarse = opts?.classificationCoarse ?? false;
    if (query.departmentId) {
      and.push(
        classificationCoarse
          ? {
              items: {
                some: {
                  deletedAt: null,
                  OR: [
                    { branchLabTestId: { not: null } },
                    { branchLabPanelId: { not: null } },
                  ],
                },
              },
            }
          : {
              items: {
                some: {
                  deletedAt: null,
                  OR: [
                    {
                      branchLabTest: {
                        is: { departmentId: query.departmentId },
                      },
                    },
                    {
                      branchLabPanel: {
                        is: { departmentId: query.departmentId },
                      },
                    },
                  ],
                },
              },
            },
      );
    }
    if (query.categoryId) {
      and.push(
        classificationCoarse
          ? {
              items: {
                some: {
                  deletedAt: null,
                  OR: [
                    { branchLabTestId: { not: null } },
                    { branchLabPanelId: { not: null } },
                  ],
                },
              },
            }
          : {
              items: {
                some: {
                  deletedAt: null,
                  OR: [
                    { branchLabTest: { is: { categoryId: query.categoryId } } },
                    {
                      branchLabPanel: { is: { categoryId: query.categoryId } },
                    },
                  ],
                },
              },
            },
      );
    }
    if (query.subCategoryId) {
      // Only lab tests carry a sub-category (panels do not), so this matches on
      // the test relation alone (coarse: any test line).
      and.push(
        classificationCoarse
          ? {
              items: {
                some: { deletedAt: null, branchLabTestId: { not: null } },
              },
            }
          : {
              items: {
                some: {
                  deletedAt: null,
                  branchLabTest: { is: { subCategoryId: query.subCategoryId } },
                },
              },
            },
      );
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

    return {
      where,
      quotationValidityValue,
      quotationValidityUnit,
      quotationExpiryCutoff,
    };
  }

  /**
   * List orders (paginated) with the payment rollups every billing/quotation
   * column needs. Filters are built by {@link buildOrderWhere}; the row map adds
   * the per-order money totals (gross, discount, net, paid, tds, due, refunds)
   * and the runtime quotation expiry.
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from the JWT profile)
   * @param query filters + pagination
   * @returns a paginated page of {@link OrderListRow}
   */
  async findAll(
    tenantId: string,
    activeBranchId: string | null,
    query: ListOrdersDto,
  ): Promise<PaginatedResult<OrderListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const {
      where,
      quotationValidityValue,
      quotationValidityUnit,
      quotationExpiryCutoff,
    } = await this.buildOrderWhere(query, tenantId, activeBranchId);

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
      const tdsAmount = r.payments.reduce((s, p) => s + p.tdsDeduction, 0);
      const dueAmount = Math.max(0, netAmount - paidAmount);
      const refundedAmount = r.payments.reduce((s, p) => s + p.refundAmount, 0);
      const refundChargeTotal = r.payments.reduce(
        (s, p) => s + p.refundCharge,
        0,
      );
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
      // The order this quote was converted into (most recent), if any — surfaces
      // the "View Order" link on a CONVERTED quotation row.
      const converted = r.convertedOrder[0] ?? null;
      return {
        ...r,
        itemCount: count?.total ?? 0,
        collectedItemCount: count?.collected ?? 0,
        grossAmount,
        discountAmount,
        netAmount,
        tdsAmount,
        dueAmount,
        paidAmount,
        refundedAmount,
        refundChargeTotal,
        effectiveQuotationStatus,
        computedQuotationExpiryAt,
        convertedOrderId: converted?.id ?? null,
        // The converted order's order code (searchable in the Order Console) —
        // used to pre-search the order when "View Order" opens the console.
        convertedOrderCode: converted?.orderCode ?? null,
      };
    });
    return { data, total, page, limit };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Finance → Billing: one shared filtering + financial-allocation layer.
  //
  //  Active filters → buildOrderWhere → applyDimensionScope → loadBillingOrders →
  //  per-order/per-line allocation → { detailed records, grouped summary, cards }.
  //  Every Billing consumer (records / summary / grouped) runs through here, so
  //  the metric cards, the summary and the detailed records always describe the
  //  same dataset and reconcile exactly for a given tab + filters.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Distribute an integer `amount` across `weights` proportionally, exactly
   * (Σ result === amount when `sumW > 0`) using the largest-remainder method.
   */
  private allocateProportional(
    amount: number,
    weights: number[],
    sumW: number,
  ): number[] {
    const out = new Array<number>(weights.length).fill(0);
    if (weights.length === 0 || amount === 0 || sumW <= 0) return out;
    const raw = weights.map((w) => (amount * w) / sumW);
    const floors = raw.map((x) => Math.floor(x));
    let rem = amount - floors.reduce((s, x) => s + x, 0);
    const byFrac = raw
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of byFrac) {
      if (rem <= 0) break;
      floors[i] = (floors[i] ?? 0) + 1;
      rem--;
    }
    return floors;
  }

  /**
   * Fill `amount` into the lines by ASCENDING `applicable` value, capping each
   * line at its applicable amount (the Billing payment-allocation rule: the
   * cheapest test/panel is settled first). Σ result === min(amount, Σapplicable).
   */
  private fillAscending(amount: number, applicable: number[]): number[] {
    const out = new Array<number>(applicable.length).fill(0);
    let rem = amount;
    const order = applicable
      .map((v, i) => ({ i, v }))
      .sort((a, b) => a.v - b.v);
    for (const { i, v } of order) {
      if (rem <= 0) break;
      const take = Math.min(v, rem);
      out[i] = take;
      rem -= take;
    }
    return out;
  }

  /** Sum an order's active payment ledger into the order-level money figures. */
  /** An all-zero {@link BillingFigures}. */
  private zeroFigures(): BillingFigures {
    return {
      gross: 0,
      discount: 0,
      net: 0,
      paid: 0,
      due: 0,
      tds: 0,
      cash: 0,
      upi: 0,
      bankTransfer: 0,
      debitCard: 0,
      creditCard: 0,
      refundAmount: 0,
      cancelAmount: 0,
    };
  }

  /** Add every field of `f` into `acc` (mutates `acc`). */
  private addFigures(acc: BillingFigures, f: BillingFigures): void {
    acc.gross += f.gross;
    acc.discount += f.discount;
    acc.net += f.net;
    acc.paid += f.paid;
    acc.due += f.due;
    acc.tds += f.tds;
    acc.cash += f.cash;
    acc.upi += f.upi;
    acc.bankTransfer += f.bankTransfer;
    acc.debitCard += f.debitCard;
    acc.creditCard += f.creditCard;
    acc.refundAmount += f.refundAmount;
    acc.cancelAmount += f.cancelAmount;
  }

  /**
   * Order-level money figures, with `paidAmount` bucketed by payment mode. For a
   * `collection` report `paid` is the sum of the five physical receipt modes
   * (WALLET excluded); for `billing` it stays the full ledger paid.
   */
  private orderLevelFigures(
    order: BillingOrder,
    report: BillingReport,
  ): BillingFigures {
    let gross = 0;
    let discount = 0;
    let net = 0;
    let tds = 0;
    let cash = 0;
    let upi = 0;
    let bankTransfer = 0;
    let debitCard = 0;
    let creditCard = 0;
    let wallet = 0;
    let refundAmount = 0;
    for (const p of order.payments) {
      gross += p.totalAmount;
      discount += p.orderDiscount;
      net += p.netAmount;
      tds += p.tdsDeduction;
      // REFUND rows carry `refundAmount` (0 on PAYMENT rows) — Σ = total refunded.
      refundAmount += p.refundAmount;
      const a = p.paidAmount;
      switch (p.paymentMode) {
        case PaymentMode.CASH:
          cash += a;
          break;
        case PaymentMode.UPI:
          upi += a;
          break;
        case PaymentMode.BANK_TRANSFER:
          bankTransfer += a;
          break;
        case PaymentMode.CARD:
          debitCard += a; // CARD → Debit Card
          break;
        case PaymentMode.CREDIT:
          creditCard += a; // CREDIT → Credit Card
          break;
        case PaymentMode.WALLET:
          wallet += a;
          break;
      }
    }
    // The "Discount" figure = order-level discount + every per-line-item
    // discount. Line discounts are already folded into `netAmount`
    // (net = totalAmount − Σ itemDiscount − orderDiscount), so surfacing them
    // here keeps `gross − discount === net` and stops genuinely-discounted
    // orders from showing a ₹0 discount.
    for (const it of order.items) discount += it.discount;
    const receipts = cash + upi + bankTransfer + debitCard + creditCard;
    const paid = report === 'collection' ? receipts : receipts + wallet;
    // Gross is DERIVED as net + discount (not raw Σ totalAmount): the ledger
    // guarantees net = totalAmount − discount, so for valid data this equals
    // Σ totalAmount, while keeping `gross ≥ net` and `gross − discount === net`
    // and matching the per-line gross allocation (item-dimension tabs = the "all"
    // tab). Guards against inconsistent ledgers where netAmount > totalAmount.
    gross = net + discount;
    return {
      gross,
      discount,
      net,
      paid,
      due: Math.max(0, net - paid),
      tds,
      cash,
      upi,
      bankTransfer,
      debitCard,
      creditCard,
      refundAmount,
      // The cancellation charge retained on the order (Cancel report).
      cancelAmount: order.cancellationCharge ?? 0,
    };
  }

  /**
   * Resolve, for a set of orders, each order's current outstanding `due` and its
   * four referral-party FKs — the single sanctioned reuse point for the Invoice
   * module (CLAUDE.md rule #3: injected via DI, never a direct file import). Uses
   * the SAME `orderLevelFigures(o, 'outstanding')` the Outstanding report uses, so
   * invoicing stays reconciled with that report by construction.
   *
   * Runs inside the caller's tenant transaction (`tx`) so the reads share the RLS
   * GUC set by `withTenant`.
   *
   * @param tx active tenant-scoped transaction client (from `withTenant`)
   * @param tenantId tenant scope (defence in depth on top of RLS)
   * @param orderIds the source order ids to resolve
   * @returns a map keyed by order id → `{ due, party FKs }`; ids that don't resolve
   *   to an active order in the tenant are simply absent from the map
   */
  async getOutstandingInfoForOrders(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderIds: string[],
  ): Promise<
    Map<
      string,
      {
        due: number;
        referralPanelId: string | null;
        referredByDoctorId: string | null;
        internalReferralId: string | null;
        externalReferralId: string | null;
      }
    >
  > {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, tenantId, deletedAt: null },
      include: BILLING_ORDER_INCLUDE,
    });
    const result = new Map<
      string,
      {
        due: number;
        referralPanelId: string | null;
        referredByDoctorId: string | null;
        internalReferralId: string | null;
        externalReferralId: string | null;
      }
    >();
    for (const o of orders) {
      result.set(o.id, {
        due: this.orderLevelFigures(o, 'outstanding').due,
        referralPanelId: o.referralPanelId,
        referredByDoctorId: o.referredByDoctorId,
        internalReferralId: o.internalReferralId,
        externalReferralId: o.externalReferralId,
      });
    }
    return result;
  }

  /**
   * Resolve, for a set of PAYMENTS (collected receipts), each payment's collected
   * amount + its order's four referral-party FKs + the payment date + the order's
   * COLLECTION money figures prorated to that payment (order figure × payment.paid ÷
   * order collected). The single sanctioned reuse point for the Settlement module
   * (per-payment grain; CLAUDE.md rule #3 — injected via DI). `paid` is the
   * settlement basis (a single physical receipt's collected amount).
   *
   * Runs inside the caller's tenant transaction (`tx`) so the reads share the RLS
   * GUC set by `withTenant`.
   *
   * @param tx active tenant-scoped transaction client (from `withTenant`)
   * @param tenantId tenant scope (defence in depth on top of RLS)
   * @param paymentIds the source payment ids to resolve
   * @returns a map keyed by payment id → `{ paid, orderId, paymentDate, *Share, party
   *   FKs }`; ids that don't resolve to an active payment/order are simply absent
   */
  async getCollectionInfoForPayments(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentIds: string[],
  ): Promise<
    Map<
      string,
      {
        paid: number;
        orderId: string;
        paymentDate: Date;
        grossShare: number;
        discountShare: number;
        netShare: number;
        dueShare: number;
        referralPanelId: string | null;
        referredByDoctorId: string | null;
        internalReferralId: string | null;
        externalReferralId: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        paid: number;
        orderId: string;
        paymentDate: Date;
        grossShare: number;
        discountShare: number;
        netShare: number;
        dueShare: number;
        referralPanelId: string | null;
        referredByDoctorId: string | null;
        internalReferralId: string | null;
        externalReferralId: string | null;
      }
    >();
    if (paymentIds.length === 0) return result;
    const payments = await tx.paymentDetails.findMany({
      where: { id: { in: paymentIds }, tenantId, deletedAt: null },
      select: {
        id: true,
        paidAmount: true,
        orderId: true,
        paymentDate: true,
        createdAt: true,
      },
    });
    const orderIds = [...new Set(payments.map((p) => p.orderId))];
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, tenantId, deletedAt: null },
      include: BILLING_ORDER_INCLUDE,
    });
    const figByOrder = new Map(
      orders.map((o) => [
        o.id,
        { fig: this.orderLevelFigures(o, 'collection'), order: o },
      ]),
    );
    for (const p of payments) {
      const entry = figByOrder.get(p.orderId);
      if (!entry) continue;
      const { fig, order: o } = entry;
      // Prorate the order-level figures to this payment's share of the order's
      // total collected, so per-payment snapshots reconcile to order totals.
      const factor = fig.paid > 0 ? p.paidAmount / fig.paid : 0;
      result.set(p.id, {
        paid: p.paidAmount,
        orderId: p.orderId,
        paymentDate: p.paymentDate ?? p.createdAt,
        grossShare: Math.round(fig.gross * factor),
        discountShare: Math.round(fig.discount * factor),
        netShare: Math.round(fig.net * factor),
        dueShare: Math.round(fig.due * factor),
        referralPanelId: o.referralPanelId,
        referredByDoctorId: o.referredByDoctorId,
        internalReferralId: o.internalReferralId,
        externalReferralId: o.externalReferralId,
      });
    }
    return result;
  }

  /**
   * Resolve, per PAYMENT, how much of its collected amount is already **reserved**
   * by settlements — used by the Settlement module (create eligibility + Approved
   * cap) and the Collection report (per-record remaining). A settlement reserves,
   * per source payment, its `approvedAmount` weighted by that payment's share of the
   * settlement's basis: `approvedAmount × collectedAmount / paidAmount`. Summed over
   * the payment's links whose settlement is NOT rejected and NOT soft-deleted.
   *
   * Derived (not stored) so it stays correct when Approved is edited/approved and
   * frees automatically when a settlement is rejected. Queries the
   * `settlement_source_payments` table directly (not the Settlement service) to
   * avoid a circular module dependency.
   *
   * @param client tenant-scoped client — pass the active `tx` when inside a
   *   `withTenant` block (e.g. settlement create), else the request-scoped
   *   `this.prisma` (e.g. the Collection report read).
   * @param tenantId tenant scope (defence in depth on top of RLS)
   * @param paymentIds the payment ids to resolve
   * @param excludeSettlementId when set, ignore this settlement's own links — so a
   *   settlement can compute how much its payments are committed to OTHER
   *   settlements (used to cap its Approved without counting itself).
   * @returns map of payment id → reserved amount (whole rupees; absent = 0)
   */
  async getReservedForPayments(
    client: Prisma.TransactionClient,
    tenantId: string,
    paymentIds: string[],
    excludeSettlementId?: string,
  ): Promise<Map<string, number>> {
    const reserved = new Map<string, number>();
    if (paymentIds.length === 0) return reserved;
    const links = await client.settlementSourcePayment.findMany({
      where: {
        tenantId,
        paymentId: { in: paymentIds },
        deletedAt: null,
        ...(excludeSettlementId
          ? { settlementId: { not: excludeSettlementId } }
          : {}),
        settlement: {
          is: { status: { not: SettlementStatus.REJECTED }, deletedAt: null },
        },
      },
      select: {
        paymentId: true,
        collectedAmount: true,
        settlement: { select: { approvedAmount: true, paidAmount: true } },
      },
    });
    for (const l of links) {
      const paid = l.settlement.paidAmount;
      if (paid <= 0) continue;
      const share = l.collectedAmount / paid;
      const contribution = Math.round(l.settlement.approvedAmount * share);
      reserved.set(
        l.paymentId,
        (reserved.get(l.paymentId) ?? 0) + contribution,
      );
    }
    return reserved;
  }

  /**
   * Allocate the order-level money across its line items so the per-line sums
   * reconcile with the order totals exactly:
   * - `gross` per line = `unitPrice` (Σ = totalAmount).
   * - `discount` per line = its proportional share of the order-level discount
   *   (weighted by the line's post-item-discount value; Σ = orderDiscount).
   * - `net` per line = `(unitPrice − itemDiscount) − discountShare`
   *   (Σ = totalAmount − Σ itemDiscount − orderDiscount = netAmount).
   * - `paid` per line = filled by ASCENDING net (cheapest line settled first),
   *   capped at the line's net (Σ paid = paidAmount).
   * - `tds` per line = its proportional share of the order TDS, weighted by net
   *   (TDS is a % of net, so it spreads evenly; Σ tds = tdsDeduction).
   * - `due` per line = `net − paid` (Σ = order due).
   */
  private allocateOrderLines(
    order: BillingOrder,
    report: BillingReport,
    classMap?: ClassificationFallback,
  ): AllocatedBillingLine[] {
    const fig = this.orderLevelFigures(order, report);
    // Only the ORDER-LEVEL discount is shared proportionally across lines; each
    // line's own item discount is added back per-line below. (`fig.discount`
    // already bundles order + every item discount, so using it here would
    // double-count the item discounts.)
    const orderDiscount = order.payments.reduce(
      (s, p) => s + p.orderDiscount,
      0,
    );
    const netTotal = fig.net;
    const paidTotal = fig.paid;
    const tdsTotal = fig.tds;
    const items = order.items;
    const base = items.map((it) => Math.max(0, it.unitPrice - it.discount));
    const sumBase = base.reduce((s, x) => s + x, 0);
    const discShare = this.allocateProportional(orderDiscount, base, sumBase);
    const net = items.map((_, k) =>
      Math.max(0, (base[k] ?? 0) - (discShare[k] ?? 0)),
    );
    // If the ledger's netAmount disagrees with (Σ base − orderDiscount) — e.g.
    // visiting charges — nudge the largest line so Σ net === netAmount exactly.
    const netDrift = netTotal - net.reduce((s, x) => s + x, 0);
    if (netDrift !== 0 && net.length > 0) {
      let big = 0;
      for (let k = 1; k < net.length; k++) {
        if ((net[k] ?? 0) > (net[big] ?? 0)) big = k;
      }
      net[big] = Math.max(0, (net[big] ?? 0) + netDrift);
    }
    const paid = this.fillAscending(paidTotal, net);
    const sumNet = net.reduce((s, x) => s + x, 0);
    const tds = this.allocateProportional(tdsTotal, net, sumNet);
    // Refund + cancellation-charge are order-level events; spread them across the
    // lines proportionally by net (like TDS) so item-dimension tabs reconcile.
    const refund = this.allocateProportional(fig.refundAmount, net, sumNet);
    const cancel = this.allocateProportional(fig.cancelAmount, net, sumNet);
    // Split EACH line's paid across the payment modes, proportional to the order's
    // mode mix, so `Σ modes === the line's paid` exactly — reconciles for every
    // dimension, including when the paid was capped at net.
    const modeWeights = [
      fig.cash,
      fig.upi,
      fig.bankTransfer,
      fig.debitCard,
      fig.creditCard,
    ];
    const modeTotal = modeWeights.reduce((s, x) => s + x, 0);
    const cash: number[] = [];
    const upi: number[] = [];
    const bankTransfer: number[] = [];
    const debitCard: number[] = [];
    const creditCard: number[] = [];
    for (let k = 0; k < items.length; k++) {
      const split = this.allocateProportional(
        paid[k] ?? 0,
        modeWeights,
        modeTotal,
      );
      cash[k] = split[0] ?? 0;
      upi[k] = split[1] ?? 0;
      bankTransfer[k] = split[2] ?? 0;
      debitCard[k] = split[3] ?? 0;
      creditCard[k] = split[4] ?? 0;
    }
    return items.map((it, k) => {
      // Classification: prefer the branch scalar, fall back to the MASTER
      // catalogue (mapping usually lives there, not on the branch copy).
      const srcId =
        it.branchLabTest?.sourceLabTestId ??
        it.branchLabPanel?.sourceLabPanelId ??
        null;
      const master = srcId ? classMap?.get(srcId) : undefined;
      return {
        branchLabTestId: it.branchLabTestId,
        branchLabPanelId: it.branchLabPanelId,
        testName: it.branchLabTest?.testName ?? null,
        panelName: it.branchLabPanel?.panelName ?? null,
        testCode: it.branchLabTest?.testCode ?? null,
        panelCode: it.branchLabPanel?.panelCode ?? null,
        sourceLabTestId: it.branchLabTest?.sourceLabTestId ?? null,
        sourceLabPanelId: it.branchLabPanel?.sourceLabPanelId ?? null,
        departmentId:
          it.branchLabTest?.departmentId ??
          it.branchLabPanel?.departmentId ??
          master?.departmentId ??
          null,
        categoryId:
          it.branchLabTest?.categoryId ??
          it.branchLabPanel?.categoryId ??
          master?.categoryId ??
          null,
        subCategoryId:
          it.branchLabTest?.subCategoryId ?? master?.subCategoryId ?? null,
        // Gross is DERIVED as net + discount (not raw unitPrice): `net` is
        // reconciled to the ledger netAmount via the netDrift nudge, so any
        // order-level amount not represented by a line unitPrice (e.g. visiting
        // charges) is absorbed here too. Keeps `gross ≥ net` per line and
        // `Σ gross = netAmount + Σdiscount = totalAmount`. For an ordinary line
        // this equals unitPrice, so nothing changes for the common case.
        gross: (net[k] ?? 0) + it.discount + (discShare[k] ?? 0),
        // Full line discount = its own item discount + its share of the
        // order-level discount (Σ over lines = Σ itemDiscount + orderDiscount),
        // so gross − discount === net per line and the item-dimension discount
        // totals match the order-level Discount figure.
        discount: it.discount + (discShare[k] ?? 0),
        net: net[k] ?? 0,
        paid: paid[k] ?? 0,
        due: (net[k] ?? 0) - (paid[k] ?? 0),
        tds: tds[k] ?? 0,
        cash: cash[k] ?? 0,
        upi: upi[k] ?? 0,
        bankTransfer: bankTransfer[k] ?? 0,
        debitCard: debitCard[k] ?? 0,
        creditCard: creditCard[k] ?? 0,
        refundAmount: refund[k] ?? 0,
        cancelAmount: cancel[k] ?? 0,
      };
    });
  }

  /** Sum a set of allocated lines into money figures. */
  private sumLineFigures(lines: AllocatedBillingLine[]): BillingFigures {
    const f = this.zeroFigures();
    for (const l of lines) this.addFigures(f, l);
    return f;
  }

  /**
   * The classification dimensions whose group id lives on the master catalogue
   * when the branch row's own scalar is null — so they need the
   * {@link buildClassificationFallback} lookup.
   */
  private needsClassificationFallback(dimension: BillingDimension): boolean {
    return (
      dimension === 'department' ||
      dimension === 'category' ||
      dimension === 'subcategory'
    );
  }

  /** The item-level dimensions (money is allocated to matching lines). */
  private isItemDimension(dimension: BillingDimension): boolean {
    return (
      dimension === 'lab-test' ||
      dimension === 'lab-panel' ||
      dimension === 'department' ||
      dimension === 'category' ||
      dimension === 'subcategory'
    );
  }

  /** Whether an allocated line belongs to an item-level dimension. */
  private lineMatchesDimension(
    line: AllocatedBillingLine,
    dimension: BillingDimension,
  ): boolean {
    switch (dimension) {
      case 'lab-test':
        return !!line.branchLabTestId;
      case 'lab-panel':
        return !!line.branchLabPanelId;
      case 'department':
        return !!line.departmentId;
      case 'category':
        return !!line.categoryId;
      case 'subcategory':
        return !!line.subCategoryId;
      default:
        return false;
    }
  }

  /** The group id an allocated line contributes to, for an item-level dimension. */
  private lineGroupId(
    line: AllocatedBillingLine,
    dimension: BillingDimension,
  ): string | null {
    switch (dimension) {
      case 'lab-test':
        // Group by the stable test code so the same test across pricing lists
        // aggregates into one row (not one row per BranchLabTest id).
        return line.testCode ?? line.branchLabTestId;
      case 'lab-panel':
        return line.panelCode ?? line.branchLabPanelId;
      case 'department':
        return line.departmentId;
      case 'category':
        return line.categoryId;
      case 'subcategory':
        return line.subCategoryId;
      default:
        return null;
    }
  }

  /** The line's own group name (test/panel); classification names resolve by id. */
  private lineGroupName(
    line: AllocatedBillingLine,
    dimension: BillingDimension,
  ): string | null {
    if (dimension === 'lab-test') return line.testName;
    if (dimension === 'lab-panel') return line.panelName;
    return null;
  }

  /** Batch-resolve department / category / sub-category display names by id. */
  private async resolveClassificationNames(
    dimension: 'department' | 'category' | 'subcategory',
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const map = new Map<string, string>();
    if (!unique.length) return map;
    const where = { id: { in: unique } };
    const select = { id: true, name: true };
    const rows =
      dimension === 'department'
        ? await this.prisma.department.findMany({ where, select })
        : dimension === 'category'
          ? await this.prisma.category.findMany({ where, select })
          : await this.prisma.subCategory.findMany({ where, select });
    for (const r of rows) map.set(r.id, r.name);
    return map;
  }

  /**
   * The money figures an order contributes to a dimension: order-level for the
   * whole-order dimensions (`all`/`userwise`/`b2b`/`ref-by`/`internal-referral`/
   * `external-referral`/`discount`); for the item-level dimensions (`lab-test`/
   * `lab-panel`/`department`/`category`/`subcategory`) the sum of that order's
   * allocated matching lines (so the order's other value is excluded and the
   * dimension reconciles with its own cards).
   */
  private dimensionFiguresForOrder(
    order: BillingOrder,
    dimension: BillingDimension,
    report: BillingReport,
    classMap?: ClassificationFallback,
  ): BillingFigures {
    if (this.isItemDimension(dimension)) {
      const lines = this.allocateOrderLines(order, report, classMap).filter(
        (l) => this.lineMatchesDimension(l, dimension),
      );
      return this.sumLineFigures(lines);
    }
    return this.orderLevelFigures(order, report);
  }

  /**
   * Build the master-classification fallback for a set of orders: batch-loads
   * the `LabTest` / `LabPanel` department/category/sub-category for every source
   * id referenced by the orders' branch items, keyed by that source id. Empty
   * when no item carries a source id. Used so the department/category/
   * sub-category dimensions can classify branch rows whose own scalars are null
   * (the mapping lives on the master catalogue).
   */
  private async buildClassificationFallback(
    orders: BillingOrder[],
  ): Promise<ClassificationFallback> {
    const testIds = new Set<string>();
    const panelIds = new Set<string>();
    for (const o of orders) {
      for (const it of o.items) {
        const t = it.branchLabTest?.sourceLabTestId;
        if (t) testIds.add(t);
        const p = it.branchLabPanel?.sourceLabPanelId;
        if (p) panelIds.add(p);
      }
    }
    const map: ClassificationFallback = new Map();
    if (!testIds.size && !panelIds.size) return map;
    const [tests, panels] = await Promise.all([
      testIds.size
        ? this.prisma.labTest.findMany({
            where: { id: { in: [...testIds] } },
            select: {
              id: true,
              departmentId: true,
              categoryId: true,
              subCategoryId: true,
            },
          })
        : Promise.resolve([]),
      panelIds.size
        ? this.prisma.labPanel.findMany({
            where: { id: { in: [...panelIds] } },
            select: { id: true, departmentId: true, categoryId: true },
          })
        : Promise.resolve([]),
    ]);
    for (const t of tests) {
      map.set(t.id, {
        departmentId: t.departmentId,
        categoryId: t.categoryId,
        subCategoryId: t.subCategoryId,
      });
    }
    for (const p of panels) {
      // Panels carry no sub-category on the master catalogue.
      map.set(p.id, {
        departmentId: p.departmentId,
        categoryId: p.categoryId,
        subCategoryId: null,
      });
    }
    return map;
  }

  /** Narrow the base `where` to the orders a dimension covers. */
  private applyDimensionScope(
    where: Prisma.OrderWhereInput,
    dimension: BillingDimension,
  ): Prisma.OrderWhereInput {
    const and = (extra: Prisma.OrderWhereInput): Prisma.OrderWhereInput => ({
      AND: [where, extra],
    });
    // An order has a catalogue line that can carry this classification. The id
    // itself is resolved at group time (branch scalar OR the master-catalogue
    // fallback — see buildClassificationFallback), so the scope only checks that
    // a classifiable line exists; lines that resolve to no classification are
    // dropped when the figures/groups are built, keeping cards === Σ groups.
    const hasClassifiableLine = (
      field: 'departmentId' | 'categoryId' | 'subCategoryId',
    ): Prisma.OrderWhereInput =>
      and({
        items: {
          some: {
            deletedAt: null,
            OR: [
              { branchLabTestId: { not: null } },
              // Panels have no sub-category, so only tests qualify for it.
              ...(field === 'subCategoryId'
                ? []
                : [{ branchLabPanelId: { not: null } }]),
            ],
          },
        },
      });
    switch (dimension) {
      case 'b2b':
        return and({ referralPanelId: { not: null } });
      case 'ref-by':
        return and({ referredByDoctorId: { not: null } });
      case 'internal-referral':
        // Re-sourced to accession transfers: orders whose sample was sent to
        // another branch (INTERNAL SampleTransfer), not the order's referral FK.
        return and({
          accessionSamples: {
            some: {
              deletedAt: null,
              transfers: {
                some: { deletedAt: null, kind: TransferKind.INTERNAL },
              },
            },
          },
        });
      case 'external-referral':
        // Orders whose sample was sent to an external partner (EXTERNAL transfer).
        return and({
          accessionSamples: {
            some: {
              deletedAt: null,
              transfers: {
                some: { deletedAt: null, kind: TransferKind.EXTERNAL },
              },
            },
          },
        });
      case 'lab-test':
        return and({
          items: { some: { deletedAt: null, branchLabTestId: { not: null } } },
        });
      case 'lab-panel':
        return and({
          items: { some: { deletedAt: null, branchLabPanelId: { not: null } } },
        });
      case 'department':
        return hasClassifiableLine('departmentId');
      case 'category':
        return hasClassifiableLine('categoryId');
      case 'subcategory':
        return hasClassifiableLine('subCategoryId');
      case 'discount':
        // A discount was applied — order-level OR any line-level.
        return and({
          OR: [
            {
              payments: { some: { deletedAt: null, orderDiscount: { gt: 0 } } },
            },
            { items: { some: { deletedAt: null, discount: { gt: 0 } } } },
          ],
        });
      case 'int-ref-user':
        // Orders naming an internal referral user (order's Referral Details).
        return and({ internalReferralId: { not: null } });
      case 'ext-ref-user':
        // Orders naming an external referral user (order's Referral Details).
        return and({ externalReferralId: { not: null } });
      case 'outsource':
        // Orders sent to an external lab via an accession OUTSOURCE transfer
        // (the /accession/outsource view), NOT the diagnostics sample source.
        return and({
          accessionSamples: {
            some: {
              deletedAt: null,
              transfers: {
                some: { deletedAt: null, kind: TransferKind.OUTSOURCE },
              },
            },
          },
        });
      case 'back-dated':
        return and({ orderDateType: OrderDateType.BACKTRACKED });
      case 'advance-dated':
        return and({ orderDateType: OrderDateType.ADVANCE_DATED });
      case 'home-collection':
        // Home-visit orders (the booking lives on the diagnostics section).
        return and({ diagnostics: { is: { isHomeVisit: true } } });
      // Whole-dataset dimensions carry no extra scope beyond the base `where`.
      case 'all':
      case 'userwise':
        return where;
      default: {
        // Exhaustive guard: an unrecognized dimension must NEVER silently fall
        // through to the unscoped `where` (that would leak a branch-wide set into
        // a financial report). The `never` assignment makes adding a new
        // BillingDimension a compile error until it is handled here.
        const unhandled: never = dimension;
        throw new Error(`Unhandled billing dimension: ${String(unhandled)}`);
      }
    }
  }

  /**
   * The single scoped dataset for a report + dimension + filters — the source
   * both the summary/cards and the detailed records consume (newest-first). A
   * `collection` report additionally scopes to orders with a collected payment;
   * an `outstanding` report keeps only orders whose due balance is > 0; a
   * `refund` report keeps only orders with a REFUND ledger entry; a `cancel`
   * report keeps only CANCELLED orders.
   */
  private async loadBillingOrders(
    tenantId: string,
    activeBranchId: string | null,
    dimension: BillingDimension,
    query: ListOrdersDto,
    report: BillingReport,
  ): Promise<BillingOrder[]> {
    const { where } = await this.buildOrderWhere(
      query,
      tenantId,
      activeBranchId,
      // Classification (dept/cat/subcat) filters are relaxed to a coarse "has a
      // classifiable line" clause here and matched exactly (master-aware) in-app
      // below, so a filtered report reconciles even when the mapping lives on the
      // master catalogue rather than the branch copy.
      { classificationCoarse: true },
    );
    let scoped = this.applyDimensionScope(where, dimension);
    if (report === 'collection') {
      // Realization view: only orders that actually collected money.
      scoped = {
        AND: [
          scoped,
          {
            payments: {
              some: {
                deletedAt: null,
                entryType: PaymentEntryType.PAYMENT,
                paidAmount: { gt: 0 },
              },
            },
          },
        ],
      };
    }
    if (report === 'refund') {
      // Refund view: only orders with a refund ledger entry.
      scoped = {
        AND: [
          scoped,
          {
            payments: {
              some: {
                deletedAt: null,
                entryType: PaymentEntryType.REFUND,
              },
            },
          },
        ],
      };
    }
    if (report === 'cancel') {
      // Cancel view: only cancelled orders (enforced regardless of `statuses`).
      scoped = { AND: [scoped, { status: OrderStatus.CANCELLED }] };
    }
    let orders = await this.prisma.order.findMany({
      where: scoped,
      include: BILLING_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (report === 'outstanding') {
      // Outstanding view: only orders that still owe money. `due` is a derived
      // figure (net − paid, paid incl. wallet), so it's gated in-app — this is
      // the single dataset feeding cards/records/grouped, so they all reconcile.
      orders = orders.filter(
        (o) => this.orderLevelFigures(o, 'outstanding').due > 0,
      );
      // An order's due can also be settled through a consolidated invoice, whose
      // payments post to the invoice ledger — never back to the order's own
      // PaymentDetails. Drop orders linked to a fully-paid (COMPLETED) invoice so
      // the Outstanding view reflects invoice settlement too. Invoiced-but-unpaid
      // orders stay (money is still owed until the invoice completes); a cancelled
      // invoice soft-deletes its links, so those orders reappear automatically.
      const settled = await this.invoiceSettledOrderIds(
        tenantId,
        orders.map((o) => o.id),
      );
      if (settled.size > 0) {
        orders = orders.filter((o) => !settled.has(o.id));
      }
    }
    if (report === 'collection') {
      // Realization view: WALLET is excluded from collection `paid`
      // (orderLevelFigures), but the DB scope above admits any PAYMENT row —
      // including wallet-mode ones. An order paid ONLY via wallet therefore nets
      // to `paid = 0` here; drop it in-app (mirrors the outstanding gate) so the
      // detail list never shows unrelated ₹0 rows and records/cards/count all
      // reconcile off this single dataset.
      orders = orders.filter(
        (o) => this.orderLevelFigures(o, 'collection').paid > 0,
      );
    }
    // A master-classification fallback is needed when the active dimension is a
    // classification dimension OR when a classification FILTER (dept/cat/subcat)
    // is set — because in either case a line's group/match id may live on the
    // master catalogue, not the branch copy.
    const classFilterActive = !!(
      query.departmentId ||
      query.categoryId ||
      query.subCategoryId
    );
    const classMap =
      this.needsClassificationFallback(dimension) || classFilterActive
        ? await this.buildClassificationFallback(orders)
        : undefined;

    if (classFilterActive) {
      // Exact classification FILTER: the DB pre-filter only guaranteed "has a
      // classifiable line" (buildOrderWhere `classificationCoarse`), because the
      // mapping often lives on the master catalogue, which a Prisma `where` can't
      // express. Keep an order only if one of its allocated lines resolves
      // (branch scalar OR master fallback) to EVERY set classification filter, so
      // the filtered report reconciles: cards = Σ records = Σ groups.
      orders = orders.filter((o) =>
        this.allocateOrderLines(o, report, classMap).some(
          (l) =>
            (!query.departmentId || l.departmentId === query.departmentId) &&
            (!query.categoryId || l.categoryId === query.categoryId) &&
            (!query.subCategoryId || l.subCategoryId === query.subCategoryId),
        ),
      );
    }

    if (this.isItemDimension(dimension)) {
      // Item dimensions (lab-test / lab-panel / department / category /
      // subcategory) must scope to orders that ACTUALLY carry a line matching the
      // dimension — the DB scope only guarantees "has a catalogue line", and a
      // classification often lives on the master (resolved via classMap), which a
      // Prisma `where` can't express. Filtering here (the single dataset feeding
      // records/cards/grouped) means the detail lists only relevant orders, cards
      // = Σ records, and each group's orderCount = unique orders with a matching
      // line — no unrelated ₹0 orders.
      orders = orders.filter((o) =>
        this.allocateOrderLines(o, report, classMap).some((l) =>
          this.lineMatchesDimension(l, dimension),
        ),
      );
    }
    return orders;
  }

  /**
   * Order ids whose outstanding due has been consolidated into a fully-paid
   * (COMPLETED) invoice. Keyed on the active (non-deleted) InvoiceSourceOrder
   * link → non-cancelled invoice; a cancelled invoice soft-deletes its links,
   * so its orders drop out of this set and return to the Outstanding report.
   * @param tenantId tenant scope (from JWT / RLS context)
   * @param orderIds candidate order ids (the already-scoped outstanding set)
   * @returns set of order ids to exclude from the Outstanding report
   */
  private async invoiceSettledOrderIds(
    tenantId: string,
    orderIds: string[],
  ): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set();
    const links = await this.prisma.invoiceSourceOrder.findMany({
      where: {
        tenantId,
        orderId: { in: orderIds },
        deletedAt: null,
        invoice: {
          deletedAt: null,
          paymentStatus: InvoicePaymentStatus.COMPLETED,
        },
      },
      select: { orderId: true },
    });
    return new Set(links.map((l) => l.orderId));
  }

  /**
   * Paginated detailed records for a Billing dimension.
   *
   * - **Order-level dimensions** (`all`/`userwise`/`b2b`/`ref-by`/referral/
   *   `discount`/date/home-collection) → **one row per order**, money = the order's
   *   order-level figures.
   * - **Item-level dimensions** (`lab-test`/`lab-panel`/`department`/`category`/
   *   `subcategory`) → **one row per matching test/panel line**, so the detail shows
   *   only the specific test/panel that belongs to the active tab (a test in 2
   *   orders → 2 rows; on department/category/subcategory the other, unmapped tests
   *   in the same order are excluded). Each row carries just that line's item + its
   *   allocated money, so `Σ rows === cards`.
   *
   * Field names mirror the order-list row so the frontend mapper is shared.
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from the JWT profile)
   * @param dimension the active Billing tab
   * @param query filters + pagination
   */
  async billingRecords(
    tenantId: string,
    activeBranchId: string | null,
    report: BillingReport,
    dimension: BillingDimension,
    query: ListOrdersDto,
  ): Promise<PaginatedResult<BillingRecordRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const orders = await this.loadBillingOrders(
      tenantId,
      activeBranchId,
      dimension,
      query,
      report,
    );

    if (this.isItemDimension(dimension)) {
      // One row per matching allocated line. `allocateOrderLines` preserves the
      // order of `order.items`, so line k ↔ items[k] — each row carries just that
      // line's raw item (so the FE shows the specific test/panel name) and the
      // line's allocated figures.
      const classMap = this.needsClassificationFallback(dimension)
        ? await this.buildClassificationFallback(orders)
        : undefined;
      const rows: BillingRecordRow[] = [];
      for (const o of orders) {
        const allocated = this.allocateOrderLines(o, report, classMap);
        for (let k = 0; k < allocated.length; k++) {
          const l = allocated[k]!;
          if (!this.lineMatchesDimension(l, dimension)) continue;
          const item = o.items[k];
          rows.push({
            ...o,
            items: item ? [item] : [],
            grossAmount: l.gross,
            discountAmount: l.discount,
            netAmount: l.net,
            tdsAmount: l.tds,
            dueAmount: l.due,
            paidAmount: l.paid,
            cash: l.cash,
            upi: l.upi,
            bankTransfer: l.bankTransfer,
            debitCard: l.debitCard,
            creditCard: l.creditCard,
            refundAmount: l.refundAmount,
            cancelAmount: l.cancelAmount,
          });
        }
      }
      const total = rows.length;
      const data = rows.slice((page - 1) * limit, page * limit);
      return { data, total, page, limit };
    }

    // Collection report (order-level dimensions) is re-grained to ONE ROW PER
    // COLLECTED PAYMENT: each physical receipt is an independently selectable /
    // settleable record. Every other report stays one row per order.
    if (report === 'collection') {
      const physicalModes = new Set<PaymentMode>([
        PaymentMode.CASH,
        PaymentMode.UPI,
        PaymentMode.BANK_TRANSFER,
        PaymentMode.CARD,
        PaymentMode.CREDIT,
      ]);
      // Flatten matched orders → their qualifying payment rows (PAYMENT entry,
      // physical mode, positive amount — WALLET/REFUND excluded, matching the
      // Collection `paid` definition).
      const payRows: {
        order: BillingOrder;
        payment: BillingOrder['payments'][number];
        orderPaid: number;
        fig: BillingFigures;
      }[] = [];
      for (const o of orders) {
        const fig = this.orderLevelFigures(o, 'collection');
        for (const p of o.payments) {
          if (p.entryType !== PaymentEntryType.PAYMENT) continue;
          if (!physicalModes.has(p.paymentMode)) continue;
          if (p.paidAmount <= 0) continue;
          payRows.push({ order: o, payment: p, orderPaid: fig.paid, fig });
        }
      }
      const total = payRows.length;
      const pageRows = payRows.slice((page - 1) * limit, page * limit);
      const reserved = await this.getReservedForPayments(
        this.prisma,
        tenantId,
        pageRows.map((r) => r.payment.id),
      );
      const data = pageRows.map(({ order: o, payment: p, orderPaid, fig }) => {
        // Prorate order figures by this payment's share of the order's collected.
        const factor = orderPaid > 0 ? p.paidAmount / orderPaid : 0;
        const settlementSettled = reserved.get(p.id) ?? 0;
        const modeAmt = (m: PaymentMode) =>
          p.paymentMode === m ? p.paidAmount : 0;
        return {
          ...o,
          grossAmount: Math.round(fig.gross * factor),
          discountAmount: Math.round(fig.discount * factor),
          netAmount: Math.round(fig.net * factor),
          tdsAmount: Math.round(fig.tds * factor),
          dueAmount: Math.round(fig.due * factor),
          paidAmount: p.paidAmount,
          cash: modeAmt(PaymentMode.CASH),
          upi: modeAmt(PaymentMode.UPI),
          bankTransfer: modeAmt(PaymentMode.BANK_TRANSFER),
          debitCard: modeAmt(PaymentMode.CARD),
          creditCard: modeAmt(PaymentMode.CREDIT),
          refundAmount: 0,
          cancelAmount: 0,
          settlementSettled,
          settlementRemaining: Math.max(0, p.paidAmount - settlementSettled),
          paymentId: p.id,
          paymentMode: p.paymentMode,
          paymentReference: p.reference,
          paymentDate: p.paymentDate ?? p.createdAt,
        };
      });
      return { data, total, page, limit };
    }

    // Order-level dimensions (non-collection): one row per order.
    const total = orders.length;
    const pageOrders = orders.slice((page - 1) * limit, page * limit);
    const data = pageOrders.map((o) => {
      const f = this.dimensionFiguresForOrder(o, dimension, report);
      return {
        ...o,
        grossAmount: f.gross,
        discountAmount: f.discount,
        netAmount: f.net,
        tdsAmount: f.tds,
        dueAmount: f.due,
        paidAmount: f.paid,
        cash: f.cash,
        upi: f.upi,
        bankTransfer: f.bankTransfer,
        debitCard: f.debitCard,
        creditCard: f.creditCard,
        refundAmount: f.refundAmount,
        cancelAmount: f.cancelAmount,
      };
    });
    return { data, total, page, limit };
  }

  /**
   * Aggregate metric-card totals for a Billing dimension — summed over the SAME
   * scoped dataset {@link billingRecords} paginates, using the SAME per-order
   * figures, so `Σ detailed records === cards` for any tab + filters.
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from the JWT profile)
   * @param dimension the active Billing tab (defaults to `all`)
   * @param query the Billing filter set (same DTO as the list)
   * @returns gross/discount/net/paid/due/tds totals (minor units)
   */
  async billingSummary(
    tenantId: string,
    activeBranchId: string | null,
    report: BillingReport,
    dimension: BillingDimension,
    query: ListOrdersDto,
  ): Promise<BillingSummary> {
    const orders = await this.loadBillingOrders(
      tenantId,
      activeBranchId,
      dimension,
      query,
      report,
    );
    const classMap = this.needsClassificationFallback(dimension)
      ? await this.buildClassificationFallback(orders)
      : undefined;
    const summary = this.zeroFigures();
    for (const o of orders) {
      this.addFigures(
        summary,
        this.dimensionFiguresForOrder(o, dimension, report, classMap),
      );
    }
    return summary;
  }

  /**
   * User-wise Billing aggregate for the Finance → Reports "User-wise" panel:
   * the same totals as {@link billingSummary} grouped by the order's creator
   * (`Order.createdBy`). Reuses {@link buildOrderWhere} for identical filtering,
   * resolves creator display names in one batched lookup, and returns one row per
   * user (orders with no recorded creator collapse into a single `''` bucket).
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from the JWT profile)
   * @param query the Billing filter set (same DTO as the list)
   * @returns one aggregate row per creating user
   */
  async billingSummaryByUser(
    tenantId: string,
    activeBranchId: string | null,
    report: BillingReport,
    query: ListOrdersDto,
  ): Promise<BillingSummaryByUserRow[]> {
    // User-wise = the whole scoped dataset (no dimension scope) grouped by creator.
    const orders = await this.loadBillingOrders(
      tenantId,
      activeBranchId,
      'userwise',
      query,
      report,
    );

    type Acc = Omit<BillingSummaryByUserRow, 'userId' | 'userName'>;
    const byUser = new Map<string, Acc>();
    const ensure = (id: string): Acc => {
      let acc = byUser.get(id);
      if (!acc) {
        acc = { orderCount: 0, ...this.zeroFigures() };
        byUser.set(id, acc);
      }
      return acc;
    };

    for (const o of orders) {
      const acc = ensure(o.createdBy ?? '');
      acc.orderCount += 1;
      this.addFigures(acc, this.orderLevelFigures(o, report));
    }

    const names = await this.resolveActorNames([...byUser.keys()]);
    return [...byUser.entries()].map(([userId, acc]) => ({
      userId,
      userName: userId ? (names.get(userId) ?? userId) : 'Unknown',
      ...acc,
    }));
  }

  /**
   * Grouped Billing summary for the Finance → Reports → Billing dimension panels.
   * Uses the SAME scoped dataset as {@link billingSummary}`(groupBy)`, so the group
   * rows always sum back to that tab's cards. Two families:
   *
   * - **Order-level** (`b2b` / `ref-by` / `internal-referral` /
   *   `external-referral`) — groups whole orders by the referral panel / doctor /
   *   internal / external referral; every money field is order-level. Orders
   *   without that referral are excluded.
   * - **Item-level** (`lab-test` / `lab-panel` / `department` / `category` /
   *   `subcategory`) — groups each order's **allocated** lines (see
   *   {@link allocateOrderLines}) by test / panel / classification, so
   *   gross/discount/net **and** paid/due/tds are all populated. Classification
   *   display names are resolved by id in one batched lookup.
   *
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from the JWT profile)
   * @param groupBy the dimension to group by
   * @param query the Billing filter set (same DTO as the list)
   * @returns one aggregate row per group
   */
  async billingSummaryGrouped(
    tenantId: string,
    activeBranchId: string | null,
    report: BillingReport,
    groupBy: BillingGroupBy,
    query: ListOrdersDto,
  ): Promise<BillingGroupRow[]> {
    // Same scoped dataset as billingSummary(groupBy) — so grouped rows sum back
    // to the cards for that tab.
    const orders = await this.loadBillingOrders(
      tenantId,
      activeBranchId,
      groupBy,
      query,
      report,
    );

    const byGroup = new Map<
      string,
      BillingGroupRow & { orders: Set<string> }
    >();
    const ensure = (id: string, name: string) => {
      let row = byGroup.get(id);
      if (!row) {
        row = {
          id,
          name,
          orderCount: 0,
          ...this.zeroFigures(),
          orders: new Set<string>(),
        };
        byGroup.set(id, row);
      }
      return row;
    };
    const add = (row: BillingGroupRow, f: BillingFigures) =>
      this.addFigures(row, f);

    // Internal / external referral (by accession-transfer destination) and
    // outsource (by outsource center) group a re-sourced accession-transfer
    // dataset, not the order's own FK — handled apart.
    if (
      groupBy === 'internal-referral' ||
      groupBy === 'external-referral' ||
      groupBy === 'outsource'
    ) {
      return this.billingSummaryGroupedByReferralTransfer(
        tenantId,
        orders,
        groupBy,
        report,
      );
    }

    if (this.isItemDimension(groupBy)) {
      // Item-level dimensions (lab-test / lab-panel / department / category /
      // subcategory): group each order's ALLOCATED lines, so paid/due/tds carry
      // the same allocation the detailed records show.
      const classMap = this.needsClassificationFallback(groupBy)
        ? await this.buildClassificationFallback(orders)
        : undefined;
      for (const o of orders) {
        for (const l of this.allocateOrderLines(o, report, classMap)) {
          const id = this.lineGroupId(l, groupBy);
          if (!id) continue;
          // Classification names are resolved by id below; test/panel names are
          // already on the line.
          const row = ensure(id, this.lineGroupName(l, groupBy) ?? id);
          row.orders.add(o.id);
          add(row, l);
        }
      }
      if (
        groupBy === 'department' ||
        groupBy === 'category' ||
        groupBy === 'subcategory'
      ) {
        const names = await this.resolveClassificationNames(groupBy, [
          ...byGroup.keys(),
        ]);
        for (const [id, row] of byGroup) row.name = names.get(id) ?? id;
      }
    } else {
      // Order-level dimensions: group whole orders by referral panel / doctor.
      // (internal-/external-referral are handled by the transfer branch above.)
      for (const o of orders) {
        let id: string | null = null;
        let name = '';
        switch (groupBy) {
          case 'b2b':
            id = o.referralPanelId;
            name = o.referralPanel?.name ?? '';
            break;
          case 'ref-by':
            id = o.referredByDoctorId;
            name = [o.referredByDoctor?.firstName, o.referredByDoctor?.lastName]
              .filter(Boolean)
              .join(' ')
              .trim();
            break;
          case 'int-ref-user':
            id = o.internalReferralId;
            name = o.internalReferral?.fullName ?? '';
            break;
          case 'ext-ref-user':
            id = o.externalReferralId;
            name = o.externalReferral?.name ?? '';
            break;
        }
        if (!id) continue;
        const row = ensure(id, name || id);
        row.orders.add(o.id);
        add(row, this.orderLevelFigures(o, report));
      }
    }

    return [...byGroup.values()].map(({ orders, ...r }) => ({
      ...r,
      orderCount: orders.size,
    }));
  }

  /**
   * Grouped Billing/Collection summary for the Internal / External Referral and
   * Outsource tabs, re-sourced to accession transfers (not the order's referral
   * FK): each scoped order (one that has an INTERNAL/EXTERNAL/OUTSOURCE
   * {@link SampleTransfer}) is attributed **order-level** to a single
   * destination — an internal transfer's destination branch, an external
   * transfer's partner, or an outsource transfer's outsource center. Money is
   * order-level (same model as the other order-level tabs), so within this tab
   * `cards = Σ records = Σ grouped`. Orders with several transfers are attributed
   * to their **primary** (oldest) transfer's destination.
   * @param tenantId tenant scope (defence-in-depth on the transfer query)
   * @param orders the already dimension-scoped orders (from {@link loadBillingOrders})
   * @param groupBy `internal-referral` | `external-referral` | `outsource`
   * @param report billing | collection | outstanding (drives the money model)
   */
  private async billingSummaryGroupedByReferralTransfer(
    tenantId: string,
    orders: BillingOrder[],
    groupBy: 'internal-referral' | 'external-referral' | 'outsource',
    report: BillingReport,
  ): Promise<BillingGroupRow[]> {
    const kind =
      groupBy === 'internal-referral'
        ? TransferKind.INTERNAL
        : groupBy === 'external-referral'
          ? TransferKind.EXTERNAL
          : TransferKind.OUTSOURCE;
    const orderIds = orders.map((o) => o.id);
    if (!orderIds.length) return [];

    // Transfers for the scoped orders, oldest-first so each order resolves to its
    // primary (first) transfer's destination.
    const transfers = await this.prisma.sampleTransfer.findMany({
      where: {
        tenantId,
        deletedAt: null,
        kind,
        sample: { deletedAt: null, orderId: { in: orderIds } },
      },
      select: {
        destinationBranchId: true,
        externalPartnerRef: true,
        externalPartnerName: true,
        outsourceCenterId: true,
        sample: { select: { orderId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // One destination per order (its primary transfer).
    const destByOrder = new Map<string, { id: string; name: string }>();
    for (const t of transfers) {
      const orderId = t.sample.orderId;
      if (destByOrder.has(orderId)) continue;
      let id: string | null;
      let name: string;
      if (kind === TransferKind.INTERNAL) {
        id = t.destinationBranchId;
        name = ''; // resolved from Branch below
      } else if (kind === TransferKind.OUTSOURCE) {
        id = t.outsourceCenterId;
        name = ''; // resolved from OutsourceCenter below
      } else {
        id = t.externalPartnerRef ?? t.externalPartnerName;
        name = t.externalPartnerName ?? t.externalPartnerRef ?? '';
      }
      if (!id) continue;
      destByOrder.set(orderId, { id, name });
    }

    // Resolve internal destination branch display names in one batched lookup.
    if (kind === TransferKind.INTERNAL) {
      const branchIds = [
        ...new Set([...destByOrder.values()].map((d) => d.id)),
      ];
      if (branchIds.length) {
        const branches = await this.prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, name: true },
        });
        const nameById = new Map(branches.map((b) => [b.id, b.name]));
        for (const d of destByOrder.values())
          d.name = nameById.get(d.id) ?? d.id;
      }
    }

    // Resolve outsource-center display names in one batched lookup.
    if (kind === TransferKind.OUTSOURCE) {
      const centerIds = [
        ...new Set([...destByOrder.values()].map((d) => d.id)),
      ];
      if (centerIds.length) {
        const centers = await this.prisma.outsourceCenter.findMany({
          where: { id: { in: centerIds } },
          select: { id: true, name: true },
        });
        const nameById = new Map(centers.map((c) => [c.id, c.name]));
        for (const d of destByOrder.values())
          d.name = nameById.get(d.id) ?? d.id;
      }
    }

    const byGroup = new Map<
      string,
      BillingGroupRow & { orders: Set<string> }
    >();
    for (const o of orders) {
      const dest = destByOrder.get(o.id);
      if (!dest) continue;
      let row = byGroup.get(dest.id);
      if (!row) {
        row = {
          id: dest.id,
          name: dest.name || dest.id,
          orderCount: 0,
          ...this.zeroFigures(),
          orders: new Set<string>(),
        };
        byGroup.set(dest.id, row);
      }
      row.orders.add(o.id);
      this.addFigures(row, this.orderLevelFigures(o, report));
    }

    return [...byGroup.values()].map(({ orders, ...r }) => ({
      ...r,
      orderCount: orders.size,
    }));
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
        isBillGenerated: true,
        createdBy: true,
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

    // Billing-menu permission gates (branch Registration Settings, keyed on the
    // record's original creator). Loaded once; only consulted when the order has
    // a branch, a known creator, and the actor differs from that creator.
    const billingSettings =
      branchId &&
      existing?.createdBy &&
      existing.createdBy !== personId &&
      (existing.status === OrderStatus.QUOTE ||
        effectiveStatus === OrderStatus.QUOTE ||
        dto.payments !== undefined)
        ? await this.registrationSettingsService.getForBranch(
            tenantId,
            branchId,
          )
        : null;
    // Quotation edit by another user (both the stored and the target status may be
    // QUOTE — either being a quote means quotation-edit rules apply).
    if (
      billingSettings &&
      (existing?.status === OrderStatus.QUOTE ||
        effectiveStatus === OrderStatus.QUOTE) &&
      !billingSettings.BillingMenu_AllowOtherUserToEditQuotation
    ) {
      throw new QuotationEditByOtherUserNotAllowedException(
        id,
        existing!.createdBy!,
        personId,
      );
    }

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
    // Generate Bill = No (either set by this patch or already stored): the order
    // may not carry a positive paid amount. Only bites when the ledger is part of
    // this patch — a non-payment edit leaves the stored totals untouched.
    const effectiveBillGenerated =
      dto.isBillGenerated ?? existing?.isBillGenerated ?? false;
    if (dto.payments !== undefined && !effectiveBillGenerated && payPaid > 0) {
      throw new PaymentWithoutBillGeneratedException(payPaid);
    }
    // Generate Bill = No ⇒ the order is settled with nothing owed: force PAID and
    // zero the persisted ledger below (mirrors create()).
    const paymentStatus = !effectiveBillGenerated
      ? PaymentStatus.PAID
      : derivePaymentStatus(payNet, payPaid);

    // Collection by another user: when this patch replaces the ledger and the
    // collected total actually changes, a non-creator needs the branch setting on.
    // An unchanged ledger (a non-payment edit that re-sends the stored rows) is
    // allowed. `billingSettings` is only non-null for a non-creator actor.
    if (billingSettings && dto.payments !== undefined) {
      const storedPaid = await this.prisma.paymentDetails.aggregate({
        where: { orderId: id, tenantId, deletedAt: null },
        _sum: { paidAmount: true },
      });
      if (
        payPaid !== (storedPaid._sum.paidAmount ?? 0) &&
        !billingSettings.BillingMenu_AllowCollectionOfAmountByOtherUser
      ) {
        throw new PaymentCollectionByOtherUserNotAllowedException(
          id,
          existing!.createdBy!,
          personId,
        );
      }
    }

    // Enforce the branch's Previous-Dues + Partial-Billing + TDS/Discount rules
    // when a draft is finalized (or an order re-saved) to `status = ORDER`. Uses
    // the incoming ledger/items when this patch replaces them, otherwise the
    // order's stored rows — so the checks run against the order's effective state.
    // Skipped when no bill is generated — there is nothing to bill, so the
    // previous-dues / partial-billing / discount gates must not block the order.
    if (
      effectiveStatus === OrderStatus.ORDER &&
      branchId &&
      effectiveBillGenerated
    ) {
      const effectivePayments =
        dto.payments !== undefined
          ? dto.payments
          : await this.prisma.paymentDetails.findMany({
              where: { orderId: id, tenantId, deletedAt: null },
              select: {
                netAmount: true,
                paidAmount: true,
                orderDiscount: true,
                tdsDeduction: true,
              },
            });

      // Effective items + their unit prices: the incoming items (re-priced from
      // the branch catalogue) when the patch replaces them, else the stored rows
      // (whose `unitPrice` was already snapshotted at create/last save).
      let effectiveItems: OrderItemDto[];
      let itemPrices: Map<string, number>;
      if (dto.items !== undefined) {
        effectiveItems = dto.items;
        itemPrices = await this.loadItemUnitPrices(
          tenantId,
          branchId,
          dto.items,
        );
      } else {
        const stored = await this.prisma.orderItem.findMany({
          where: { orderId: id, tenantId, deletedAt: null },
          select: {
            branchLabTestId: true,
            branchLabPanelId: true,
            direct: true,
            unitPrice: true,
            discount: true,
            discountMode: true,
            discountValue: true,
          },
        });
        effectiveItems = stored.map((s) => ({
          branchLabTestId: s.branchLabTestId ?? undefined,
          branchLabPanelId: s.branchLabPanelId ?? undefined,
          direct: s.direct ?? undefined,
          discount: s.discount,
          discountMode: s.discountMode ?? undefined,
          discountValue: s.discountValue ?? undefined,
        }));
        itemPrices = new Map(
          stored.map((s) => [
            s.branchLabTestId ?? s.branchLabPanelId ?? '',
            s.unitPrice,
          ]),
        );
      }

      const hasDiscount = this.orderHasDiscount(
        effectiveItems,
        effectivePayments,
      );
      const settings = await this.registrationSettingsService.getForBranch(
        tenantId,
        branchId,
      );

      if (existing?.patientId) {
        await this.assertBillingRules({
          tenantId,
          branchId,
          status: OrderStatus.ORDER,
          patientId: existing.patientId,
          payments: effectivePayments,
          previousDuesCleared: dto.previousDuesCleared ?? 0,
          excludeOrderId: id,
          settings,
          hasDiscount,
        });
      }

      this.assertDiscountAndTdsRules({
        status: OrderStatus.ORDER,
        branchId,
        settings,
        items: effectiveItems,
        payments: effectivePayments,
        itemPrices,
      });
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
    // A manual external Order/Quote id is optional here too — never required to
    // finalize an order/quote. Any supplied value is still persisted and
    // uniqueness-checked below.

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
          // Re-classify (BACKTRACKED / ADVANCE_DATED / CURRENT) whenever the order
          // date changes; leave the stored value untouched otherwise.
          orderDateType: dto.orderDate
            ? this.classifyOrderDate(dto.orderDate)
            : undefined,
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
              discountMode: i.discountMode ?? null,
              discountValue: i.discountValue ?? null,
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
              // Generate Bill = No ⇒ zero every money field except gross
              // `totalAmount` so the order carries no due and reads as settled
              // (mirrors create()).
              ...(!effectiveBillGenerated
                ? {
                    orderDiscount: 0,
                    netDiscount: 0,
                    netAmount: 0,
                    payableAmount: 0,
                    paidAmount: 0,
                    remainingBalance: 0,
                    tdsDeduction: 0,
                  }
                : {}),
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
        effectiveBillGenerated &&
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
   * Cancel an order — set `status = CANCELLED` (terminal). Optionally retains a
   * `cancellationCharge` (deducted from the order's effective paid amount) and,
   * when `dto.refund` is present, refunds part of the paid amount back to the
   * patient (a REFUND ledger row). The refund is capped at the refundable balance
   * (`paid − cancellationCharge − refunds already made`). The order and its full
   * payment ledger are preserved (unlike `remove`); `paymentStatus` is recomputed
   * off the new effective paid amount.
   * @param id order id
   * @param tenantId tenant scope
   * @param actorId acting person id (recorded as `updatedBy`), may be null
   * @param dto cancellation charge + optional refund leg
   * @returns the fully-composed order after cancellation
   * @throws OrderNotFoundException if missing/soft-deleted/other tenant
   * @throws OrderAlreadyCancelledException if already cancelled
   * @throws CancellationChargeExceedsPaidException if the charge exceeds paid
   * @throws RefundExceedsRefundableException if the refund exceeds the refundable balance
   */
  async cancel(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: CancelOrderDto,
  ): Promise<OrderWithRelations> {
    const existing = await this.findById(id, tenantId);
    if (existing.status === OrderStatus.CANCELLED) {
      throw new OrderAlreadyCancelledException(id);
    }
    // Branch Registration Settings gate the whole flow (UI + API). Null when the
    // order has no branch — then we stay permissive and trust the request body.
    const settings = existing.branchId
      ? await this.registrationSettingsService.getForBranch(
          tenantId,
          existing.branchId,
        )
      : null;
    if (settings && !settings.CancellationAndRefund_AllowOrderCancellation) {
      throw new OrderCancellationNotAllowedException(id);
    }
    // Cancellation by another user: a non-creator needs the branch setting on.
    // Legacy orders with no creator, and orders with no branch, stay permissive.
    if (
      settings &&
      existing.createdBy &&
      existing.createdBy !== actorId &&
      !settings.BillingMenu_AllowCancellationByOtherUser
    ) {
      throw new OrderCancellationByOtherUserNotAllowedException(
        id,
        existing.createdBy,
        actorId,
      );
    }
    // Effective cancellation charge: when the setting is off, force 0 (any body
    // value is ignored); when on, use the supplied value or default to the
    // configured amount. No settings (no branch) → trust the body as before.
    const cancellationCharge = settings
      ? settings.CancellationAndRefund_CancellationChargesApplicable
        ? Math.round(
            Number(
              dto.cancellationCharge ??
                settings.CancellationAndRefund_CancellationChargesAmount ??
                0,
            ),
          )
        : 0
      : (dto.cancellationCharge ?? 0);
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
      // Ledger sums drive the charge/refund guards + the paymentStatus recompute.
      const agg = await tx.paymentDetails.aggregate({
        where: { orderId: id, tenantId, deletedAt: null },
        _sum: {
          netAmount: true,
          paidAmount: true,
          refundAmount: true,
          refundCharge: true,
        },
      });
      const netSum = agg._sum.netAmount ?? 0;
      const paidSum = agg._sum.paidAmount ?? 0;
      const refundSum = agg._sum.refundAmount ?? 0;
      const refundChargeSum = agg._sum.refundCharge ?? 0;

      if (cancellationCharge > paidSum) {
        throw new CancellationChargeExceedsPaidException(
          paidSum,
          cancellationCharge,
        );
      }

      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancellationCharge,
          updatedBy: actorId,
        },
      });

      // Optional refund leg: bounded by the post-charge refundable balance.
      let newRefundSum = refundSum;
      if (dto.refund) {
        if (settings && !settings.CancellationAndRefund_AllowRefund) {
          throw new RefundNotAllowedException(id);
        }
        const refundable = computeEffectivePaid(
          paidSum,
          cancellationCharge,
          refundSum,
          refundChargeSum,
        );
        // Partial refunds off → the full refundable amount must be refunded.
        if (
          settings &&
          !settings.CancellationAndRefund_AllowPartialRefund &&
          dto.refund.amount !== refundable
        ) {
          throw new PartialRefundNotAllowedException(
            refundable,
            dto.refund.amount,
          );
        }
        if (dto.refund.amount > refundable) {
          throw new RefundExceedsRefundableException(
            refundable,
            dto.refund.amount,
          );
        }
        await tx.paymentDetails.create({
          data: {
            tenantId,
            branchId: existing.branchId,
            orderId: id,
            entryType: PaymentEntryType.REFUND,
            refundAmount: dto.refund.amount,
            paidAmount: 0,
            paymentMode: dto.refund.paymentMode,
            reference: dto.refund.reference ?? null,
            paymentDate: dto.refund.paymentDate
              ? new Date(dto.refund.paymentDate)
              : new Date(),
          },
        });
        newRefundSum += dto.refund.amount;
      }

      // Recompute paymentStatus off the effective (retained) paid amount, and
      // the refund state alongside it so a paid-then-refunded order folds to
      // "Refunded" rather than reading "Not Paid".
      const effectivePaid = computeEffectivePaid(
        paidSum,
        cancellationCharge,
        newRefundSum,
        refundChargeSum,
      );
      await tx.order.update({
        where: { id },
        data: {
          paymentStatus: derivePaymentStatus(netSum, effectivePaid),
          refundStatus: deriveRefundStatus(
            paidSum,
            cancellationCharge,
            newRefundSum,
            refundChargeSum,
          ),
        },
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
   * Refund part of an order's paid amount **without** cancelling it (the standalone
   * "Refund Without Cancellation" action). Writes a REFUND ledger row and recomputes
   * `paymentStatus` off the new effective paid amount. Supports partial/multiple
   * refunds and also tops up refunds on an already-cancelled order. The refund plus
   * any `refundCharge` is capped at the order's current refundable balance
   * (`paid − cancellationCharge − refunds already made`).
   * @param id order id
   * @param tenantId tenant scope
   * @param actorId acting person id (recorded as `updatedBy`), may be null
   * @param dto refund amount + mode (+ optional retained refund charge)
   * @returns the fully-composed order after the refund
   * @throws OrderNotFoundException if missing/soft-deleted/other tenant
   * @throws NothingToRefundException if the order has no refundable balance
   * @throws RefundExceedsRefundableException if the refund exceeds the refundable balance
   */
  async refund(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: RefundOrderDto,
  ): Promise<OrderWithRelations> {
    const existing = await this.findById(id, tenantId);
    // Branch settings gate the flow. Null when the order has no branch → permissive.
    const settings = existing.branchId
      ? await this.registrationSettingsService.getForBranch(
          tenantId,
          existing.branchId,
        )
      : null;
    if (settings && !settings.CancellationAndRefund_AllowRefund) {
      throw new RefundNotAllowedException(id);
    }
    // Effective refund charge: off → force 0; on → supplied value or configured
    // default. No settings (no branch) → trust the body as before.
    const refundCharge = settings
      ? settings.CancellationAndRefund_RefundChargesApplicable
        ? Math.round(
            Number(
              dto.refundCharge ??
                settings.CancellationAndRefund_RefundChargesAmount ??
                0,
            ),
          )
        : 0
      : (dto.refundCharge ?? 0);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const agg = await tx.paymentDetails.aggregate({
        where: { orderId: id, tenantId, deletedAt: null },
        _sum: {
          netAmount: true,
          paidAmount: true,
          refundAmount: true,
          refundCharge: true,
        },
      });
      const netSum = agg._sum.netAmount ?? 0;
      const paidSum = agg._sum.paidAmount ?? 0;
      const refundSum = agg._sum.refundAmount ?? 0;
      const refundChargeSum = agg._sum.refundCharge ?? 0;

      // Refundable = current effective paid (respects any cancellation charge and
      // prior refunds).
      const refundable = computeEffectivePaid(
        paidSum,
        existing.cancellationCharge,
        refundSum,
        refundChargeSum,
      );
      if (refundable <= 0) {
        throw new NothingToRefundException(id);
      }
      // Partial refunds off → the full refundable-to-patient amount
      // (refundable − refund charge) must be refunded in one go.
      if (
        settings &&
        !settings.CancellationAndRefund_AllowPartialRefund &&
        dto.amount !== refundable - refundCharge
      ) {
        throw new PartialRefundNotAllowedException(
          refundable - refundCharge,
          dto.amount,
        );
      }
      if (dto.amount + refundCharge > refundable) {
        throw new RefundExceedsRefundableException(
          refundable,
          dto.amount + refundCharge,
        );
      }

      await tx.paymentDetails.create({
        data: {
          tenantId,
          branchId: existing.branchId,
          orderId: id,
          entryType: PaymentEntryType.REFUND,
          refundAmount: dto.amount,
          refundCharge,
          paidAmount: 0,
          paymentMode: dto.paymentMode,
          reference: dto.reference ?? null,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        },
      });

      const newRefundSum = refundSum + dto.amount;
      const newRefundChargeSum = refundChargeSum + refundCharge;
      const effectivePaid = computeEffectivePaid(
        paidSum,
        existing.cancellationCharge,
        newRefundSum,
        newRefundChargeSum,
      );
      await tx.order.update({
        where: { id },
        data: {
          paymentStatus: derivePaymentStatus(netSum, effectivePaid),
          // Fold the refund state into the order so the billing/refund lists
          // read "Refunded" / "Partially Refunded" rather than "Not Paid".
          refundStatus: deriveRefundStatus(
            paidSum,
            existing.cancellationCharge,
            newRefundSum,
            newRefundChargeSum,
          ),
          updatedBy: actorId,
        },
      });
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

      // discountMode/discountValue are a pair — either both present (a
      // technician actively chose a mode and typed a number) or both absent
      // (no discount, or a legacy caller only sending the computed `discount`
      // amount). A PERCENT value is additionally capped at 100 here, since the
      // DTO's own @Max is a generous ceiling shared with AMOUNT mode.
      const hasMode = item.discountMode !== undefined;
      const hasValue = item.discountValue !== undefined;
      if (hasMode !== hasValue) {
        throw new InvalidOrderItemException(
          'discountMode and discountValue must both be provided together, or both omitted',
        );
      }
      if (
        item.discountMode === DiscountMode.PERCENT &&
        (item.discountValue ?? 0) > 100
      ) {
        throw new InvalidOrderItemException(
          'discountValue cannot exceed 100 when discountMode is PERCENT',
        );
      }
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
