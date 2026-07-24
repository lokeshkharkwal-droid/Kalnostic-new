import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  DoctorType,
  Order,
  OrderStatus,
  Prisma,
  QuotationStatus,
  SampleSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentService } from '../appointment/appointment.service';
import { AccessionSampleService } from '../accession/accession-sample.service';
import { SlotReservationService } from '../phlebotomist-schedule/slot-reservation.service';
import { PhlebotomistCollectionService } from '../phlebotomist-collection/phlebotomist-collection.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { OrderItemDto } from './dto/order-item.dto';
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
} from './exceptions/order.exceptions';

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
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
    private readonly accessionSamples: AccessionSampleService,
    private readonly slotReservation: SlotReservationService,
    private readonly homeVisitCollections: PhlebotomistCollectionService,
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
    const paymentStatus = derivePaymentStatus(payNet, payPaid);

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
          },
        });
        if (dto.items?.length) {
          await tx.orderItem.createMany({
            data: dto.items.map((i) => ({
              tenantId,
              branchId,
              orderId: order.id,
              branchLabTestId: i.branchLabTestId ?? null,
              branchLabPanelId: i.branchLabPanelId ?? null,
              direct: i.direct ?? null,
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

    // Quotation status filter (EXPIRED derived from quotationValidTill).
    const now = new Date();
    if (query.quotationStatus) {
      switch (query.quotationStatus) {
        case QuotationStatus.CONVERTED:
          where.quotationStatus = QuotationStatus.CONVERTED;
          break;
        case QuotationStatus.EXPIRED:
          // Stored EXPIRED, or an open DRAFT whose validity has passed.
          and.push({
            OR: [
              { quotationStatus: QuotationStatus.EXPIRED },
              {
                quotationStatus: QuotationStatus.DRAFT,
                quotationValidTill: { lt: now },
              },
            ],
          });
          break;
        case QuotationStatus.DRAFT:
          // DRAFT that has NOT expired (no validity, or validity still in future).
          where.quotationStatus = QuotationStatus.DRAFT;
          and.push({
            OR: [
              { quotationValidTill: null },
              { quotationValidTill: { gte: now } },
            ],
          });
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
      const effectiveQuotationStatus =
        r.quotationStatus === QuotationStatus.DRAFT &&
        r.quotationValidTill != null &&
        r.quotationValidTill < now
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
    const paymentStatus = derivePaymentStatus(payNet, payPaid);

    await this.prisma.withTenant(tenantId, async (tx) => {
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
        },
      });

      if (dto.items !== undefined) {
        await tx.orderItem.updateMany({
          where: { orderId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        if (dto.items.length) {
          await tx.orderItem.createMany({
            data: dto.items.map((i) => ({
              tenantId,
              branchId,
              orderId: id,
              branchLabTestId: i.branchLabTestId ?? null,
              branchLabPanelId: i.branchLabPanelId ?? null,
              direct: i.direct ?? null,
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
    });

    return this.findById(id, tenantId);
  }

  /**
   * Mark an order item's sample as collected. Idempotent — if the item is
   * already collected the original `collectedAt`/`collectedBy` are preserved.
   * Both the order and the item are validated against the caller's tenant first.
   * @param orderId order the item belongs to
   * @param itemId order item id
   * @param tenantId tenant scope (from JWT)
   * @param actorId acting person id (recorded as `collectedBy`), may be null
   * @returns the fully-composed order after the update
   * @throws OrderNotFoundException / OrderItemNotFoundException
   */
  async collectItem(
    orderId: string,
    itemId: string,
    tenantId: string,
    actorId: string | null,
  ): Promise<OrderWithRelations> {
    await this.findById(orderId, tenantId);
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId, tenantId, deletedAt: null },
      select: { id: true, collectedAt: true },
    });
    if (!item) {
      throw new OrderItemNotFoundException(orderId, itemId);
    }
    if (!item.collectedAt) {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { collectedAt: new Date(), collectedBy: actorId },
        });
      });
      // Technician Reporting's LabReport is no longer created from here.
      // Accession's own sample lifecycle now exists — LabReport creation is
      // triggered by AccessionSampleService when a sample reaches ACCEPTED
      // (see AccessionSampleService.ensureLabReportsForAcceptedSample), which
      // is the real "sample accepted" signal, not this order-item-level
      // collectedAt flag. collectedAt/collectedBy are kept as-is — they are
      // NOT read anywhere in the lab-report module (no such filter exists on
      // ListLabReportsDto; that was a stale claim in an earlier version of
      // this comment). Their real remaining uses are in THIS module: this
      // order's own PENDING/PARTIAL/COLLECTED rollup (`findAll`, filtering by
      // collectedAt null/not-null across an order's items) and a fallback
      // actor id for a report's first Audit Trail entry
      // (LabReportService.createReportForAcceptedItem).
    }
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
