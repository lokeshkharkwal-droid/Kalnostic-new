import { Injectable } from '@nestjs/common';
import {
  AppointmentType,
  DoctorType,
  Order,
  OrderStatus,
  Prisma,
  QuotationStatus,
  SampleSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
} from './entities/order.entity';
import {
  DiagnosticAppointmentRequiredException,
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
  OrderInternalReferralNotFoundException,
  OrderNotFoundException,
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an order with everything the frontend submits (items, sections,
   * payments). All refs are validated first; the graph is then created in one
   * transaction. `tenantId`/`branchId` come from context; `orderCode` is
   * system-generated.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; may be null)
   * @param dto validated payload
   * @returns the fully-composed created order
   * @throws OrderPatientNotFoundException, reference-validation 422s, OrderCodeConflictException
   */
  async create(
    tenantId: string,
    branchId: string | null,
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
    this.assertDiagnosticAppointment(dto.status, dto);

    // Appointments are created only for the Diagnostic section: when saving as
    // APPOINTMENT, the order's appointment is the Diagnostic appointment and the
    // type is DIAGNOSTIC (asserted above). Otherwise fall back to any explicit
    // top-level appointmentAt and leave the type unset.
    const appointmentAt =
      dto.status === OrderStatus.APPOINTMENT && dto.diagnostics?.appointmentAt
        ? new Date(dto.diagnostics.appointmentAt)
        : dto.appointmentAt
          ? new Date(dto.appointmentAt)
          : null;
    const appointmentType =
      dto.status === OrderStatus.APPOINTMENT
        ? AppointmentType.DIAGNOSTIC
        : null;

    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { orderCounter: { increment: 1 } },
          select: { orderCounter: true },
        });
        const orderCode = `ORD-${String(tenant.orderCounter).padStart(5, '0')}`;
        const order = await tx.order.create({
          data: {
            tenantId,
            branchId,
            orderCode,
            status: dto.status ?? OrderStatus.DRAFT,
            orderDate: new Date(dto.orderDate),
            orderType: dto.orderType,
            billingType: dto.billingType,
            isUrgentBill: dto.isUrgentBill ?? false,
            isBillGenerated: dto.isBillGenerated ?? false,
            orderNotes: dto.orderNotes ?? null,
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
    if (query.orderType) where.orderType = query.orderType;
    if (query.billingType) where.billingType = query.billingType;
    if (query.patientId) where.patientId = query.patientId;
    if (query.referredByDoctorId) {
      where.referredByDoctorId = query.referredByDoctorId;
    }
    if (query.referralPanelId) where.referralPanelId = query.referralPanelId;
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
    this.assertDiagnosticAppointment(dto.status, dto);

    const now = new Date();
    // Branch of the existing order (sections/items inherit it).
    const existing = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { branchId: true },
    });
    const branchId = existing?.branchId ?? null;

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
          orderType: dto.orderType,
          billingType: dto.billingType,
          isUrgentBill: dto.isUrgentBill,
          isBillGenerated: dto.isBillGenerated,
          orderNotes: dto.orderNotes,
          quotationStatus: dto.quotationStatus,
          quotationValidTill: dto.quotationValidTill
            ? new Date(dto.quotationValidTill)
            : undefined,
          // Derive the appointment from the Diagnostic section when saving as
          // APPOINTMENT; clear the type when the status is explicitly changed to
          // something else; leave both untouched when status isn't in the patch.
          appointmentAt:
            dto.status === OrderStatus.APPOINTMENT &&
            dto.diagnostics?.appointmentAt
              ? new Date(dto.diagnostics.appointmentAt)
              : dto.appointmentAt
                ? new Date(dto.appointmentAt)
                : undefined,
          appointmentType:
            dto.status === undefined
              ? undefined
              : dto.status === OrderStatus.APPOINTMENT
                ? AppointmentType.DIAGNOSTIC
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
    }
    return this.findById(orderId, tenantId);
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
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = { orderId: id, tenantId, deletedAt: null };
      await Promise.all([
        tx.orderItem.updateMany({ where, data: { deletedAt: now } }),
        tx.orderDiagnostics.updateMany({ where, data: { deletedAt: now } }),
        tx.orderOpd.updateMany({ where, data: { deletedAt: now } }),
        tx.orderRadiology.updateMany({ where, data: { deletedAt: now } }),
        tx.paymentDetails.updateMany({ where, data: { deletedAt: now } }),
      ]);
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
   * When an order is saved with status APPOINTMENT, an appointment is created
   * only for the Diagnostic section: the Diagnostic section must be present and
   * carry an `appointmentAt`. OPD/Radiology appointment input is ignored for now
   * (they still save as ordinary sections). The order's top-level `appointmentAt`
   * + `appointmentType` are derived from the Diagnostic section by the caller.
   * @throws DiagnosticAppointmentRequiredException when the Diagnostic section is
   *   missing or has no appointment time
   */
  private assertDiagnosticAppointment(
    status: OrderStatus | undefined,
    dto: { diagnostics?: OrderDiagnosticsDto },
  ): void {
    if (status !== OrderStatus.APPOINTMENT) {
      return;
    }
    if (!dto.diagnostics || !dto.diagnostics.appointmentAt) {
      throw new DiagnosticAppointmentRequiredException();
    }
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
