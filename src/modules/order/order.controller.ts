import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule, OrderStatus } from '@prisma/client';
import type { Response } from 'express';
import { OrderService } from './order.service';
import { PermissionCheckService } from '../permissions/services/permission-check.service';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { BillingGroupedQueryDto } from './dto/billing-grouped-query.dto';
import { BillingQueryDto } from './dto/billing-query.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import { ListOrderNotesDto } from './dto/list-order-notes.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { PatientDuesQueryDto } from './dto/patient-dues.dto';
import { PrintOrderDto } from './dto/print-order.dto';
import { ShareOrderChannelDto, ShareOrderAllDto } from './dto/share.dto';
import { CollectOrderItemDto } from './dto/collect-order-item.dto';
import { CollectGroupDto } from './dto/collect-group.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Order Management endpoints. Business-authenticated; tenant comes from the JWT
 * and the branch from the active profile. The global `JwtAuthGuard` protects all
 * routes. The create endpoint accepts the full order graph (items, sections,
 * payments) in one call.
 */
@Controller('orders')
@UseGuards(PermissionGuard)
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

  /**
   * Create an order (with items, sections, and payments) in one call. `POST
   * /orders` is a shared endpoint — the same route creates an order, a quote, or
   * an appointment (distinguished by `dto.status`), and converts a quote to an
   * order (`dto.sourceQuotationId` on a non-QUOTE save). A single route guard
   * can't tell these apart, so the required permission is resolved per-request.
   */
  @Post()
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.CREATE,
    description: 'Created an order',
  })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const ctx = {
      tenantId,
      personId,
      branchId: profile.branchId,
      profileKey: profile.profileKey,
    };
    const key =
      dto.sourceQuotationId && dto.status !== OrderStatus.QUOTE
        ? PERMISSION_KEYS.REG_CONVERT_QUOTATION
        : dto.status === OrderStatus.QUOTE
          ? PERMISSION_KEYS.REG_CREATE_QUOTATION
          : dto.status === OrderStatus.APPOINTMENT
            ? PERMISSION_KEYS.REG_CREATE_APPOINTMENT
            : PERMISSION_KEYS.REG_ALLOW_CREATE_ORDER;
    await this.permissionCheck.assert(ctx, key);
    // "Allow zero bill order": finalizing a real ORDER with Generate Bill = No
    // (no bill / zero payable) requires the dedicated permission.
    if (dto.status === OrderStatus.ORDER && dto.isBillGenerated === false) {
      await this.permissionCheck.assert(
        ctx,
        PERMISSION_KEYS.REG_ALLOW_ZERO_BILL_ORDER,
      );
    }
    // Money-field permissions: applying a discount / TDS on a finalized order
    // requires the matching permission (paid amount is normal at creation).
    if (dto.status === OrderStatus.ORDER) {
      const money = this.incomingMoney(dto);
      if (money && money.discount > 0) {
        await this.permissionCheck.assert(
          ctx,
          PERMISSION_KEYS.REG_ORDER_DISCOUNT,
        );
      }
      if (money && money.tds > 0) {
        await this.permissionCheck.assert(ctx, PERMISSION_KEYS.REG_ALLOW_TDS);
      }
    }
    return this.orderService.create(tenantId, profile.branchId, personId, dto);
  }

  /**
   * Aggregate the money fields from an order payload: total discount (order-level
   * on the first payment row + per-line item discounts), TDS, and paid amount.
   * Returns null when the payload carries no payments (so the update path leaves
   * money untouched — no permission check).
   */
  private incomingMoney(
    dto: CreateOrderDto | UpdateOrderDto,
  ): { discount: number; tds: number; paid: number } | null {
    if (!dto.payments) return null;
    const orderDiscount = dto.payments[0]?.orderDiscount ?? 0;
    const lineDiscount = (dto.items ?? []).reduce(
      (sum, item) => sum + (item.discount ?? 0),
      0,
    );
    const tds = dto.payments[0]?.tdsDeduction ?? 0;
    const paid = dto.payments.reduce((sum, p) => sum + (p.paidAmount ?? 0), 0);
    return { discount: orderDiscount + lineDiscount, tds, paid };
  }

  /**
   * Duplicate an expired quotation into a fresh DRAFT quote dated today (same
   * patient / items / pricing / referrals). Gated server-side by the branch's
   * `Quotation_AllowDuplicationOfExpiredQuotation` setting and only allowed when
   * the source quote is currently expired.
   */
  @Post(':id/duplicate')
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSION_KEYS.REG_RECREATE_QUOTATION)
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.CREATE,
    description: 'Duplicated an expired quotation',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.orderService.duplicateQuotation(
      tenantId,
      profile.branchId,
      personId,
      id,
    );
  }

  /** List orders (paginated, with search + filters). Scoped to the active branch. */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListOrdersDto,
  ) {
    return this.orderService.findAll(tenantId, profile.branchId, query);
  }

  /**
   * A patient's outstanding previous dues **business-wide** (all branches in the
   * tenant), summed across their active, non-cancelled orders. Used by the Create
   * Order screen to display + pre-validate the Previous-Dues rules. Declared
   * before `:id` so the static path isn't captured by the param route.
   */
  @Get('patient-dues')
  patientDues(
    @CurrentTenant() tenantId: string,
    @Query() query: PatientDuesQueryDto,
  ) {
    return this.orderService.getPatientDues(tenantId, query.patientId);
  }

  /**
   * Aggregated Billing metric-card totals (gross/discount/net/paid/due/tds) for
   * the active branch, scoped to the active `dimension` (tab) so the cards, the
   * grouped summary and the detailed records all describe the same dataset.
   * Declared before `:id` so the static path isn't captured by the param route.
   */
  @Get('billing-summary')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_BILLING)
  billingSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingSummary(
      tenantId,
      profile.branchId,
      'billing',
      query.dimension ?? 'all',
      query,
    );
  }

  /**
   * Paginated detailed Billing records for the active branch, scoped to the
   * active `dimension` (tab) and carrying the dimension's per-order money (the
   * order's allocated test/panel lines for `lab-test`/`lab-panel`). Reconciles
   * with `billing-summary` for the same filters. Declared before `:id`.
   */
  @Get('billing-records')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_BILLING)
  billingRecords(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingRecords(
      tenantId,
      profile.branchId,
      'billing',
      query.dimension ?? 'all',
      query,
    );
  }

  /**
   * User-wise Billing aggregate (grouped by the order's creator) for the active
   * branch — the Finance → Reports → Billing "User-wise" panel. Declared before
   * `:id` so the static path isn't captured by the param route.
   */
  @Get('billing-summary/by-user')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_BILLING)
  billingSummaryByUser(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListOrdersDto,
  ) {
    return this.orderService.billingSummaryByUser(
      tenantId,
      profile.branchId,
      'billing',
      query,
    );
  }

  /**
   * Grouped Billing aggregate for the active branch — powers the Finance →
   * Reports → Billing dimension panels (`groupBy` = `b2b` | `ref-by` |
   * `lab-test` | `lab-panel`). Declared before `:id` so the static path isn't
   * captured by the param route.
   */
  @Get('billing-summary/grouped')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_BILLING)
  billingSummaryGrouped(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingGroupedQueryDto,
  ) {
    return this.orderService.billingSummaryGrouped(
      tenantId,
      profile.branchId,
      'billing',
      query.groupBy,
      query,
    );
  }

  // ── Finance → Reports → Collection (realization view + payment-mode breakup) ──
  // Reuses the shared billing dimension/allocation layer with `report:'collection'`
  // (dataset scoped to orders with a collected payment; `paid` = the five physical
  // receipt modes, WALLET excluded). Declared before `:id`.

  /** Collection metric-card totals (incl. the payment-mode breakdown). */
  @Get('collection-summary')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_COLLECTION)
  collectionSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingSummary(
      tenantId,
      profile.branchId,
      'collection',
      query.dimension ?? 'all',
      query,
    );
  }

  /** Paginated detailed Collection records (per-row payment-mode breakdown). */
  @Get('collection-records')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_COLLECTION)
  collectionRecords(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingRecords(
      tenantId,
      profile.branchId,
      'collection',
      query.dimension ?? 'all',
      query,
    );
  }

  /** User-wise Collection aggregate (grouped by order creator). */
  @Get('collection-summary/by-user')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_COLLECTION)
  collectionSummaryByUser(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListOrdersDto,
  ) {
    return this.orderService.billingSummaryByUser(
      tenantId,
      profile.branchId,
      'collection',
      query,
    );
  }

  /** Grouped Collection aggregate for the dimension panels. */
  @Get('collection-summary/grouped')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_COLLECTION)
  collectionSummaryGrouped(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingGroupedQueryDto,
  ) {
    return this.orderService.billingSummaryGrouped(
      tenantId,
      profile.branchId,
      'collection',
      query.groupBy,
      query,
    );
  }

  // ── Finance → Reports → Outstanding (orders with a due balance > 0) ──
  // Reuses the shared billing dimension/allocation layer with `report:'outstanding'`
  // (dataset filtered to orders whose `due` = net − paid is > 0; `paid` includes
  // wallet, same as billing). Declared before `:id`.

  /** Outstanding metric-card totals (only orders that still owe money). */
  @Get('outstanding-summary')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_OUTSTANDING)
  outstandingSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingSummary(
      tenantId,
      profile.branchId,
      'outstanding',
      query.dimension ?? 'all',
      query,
    );
  }

  /** Paginated detailed Outstanding records (every row has due > 0). */
  @Get('outstanding-records')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_OUTSTANDING)
  outstandingRecords(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingRecords(
      tenantId,
      profile.branchId,
      'outstanding',
      query.dimension ?? 'all',
      query,
    );
  }

  /** User-wise Outstanding aggregate (grouped by order creator). */
  @Get('outstanding-summary/by-user')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_OUTSTANDING)
  outstandingSummaryByUser(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListOrdersDto,
  ) {
    return this.orderService.billingSummaryByUser(
      tenantId,
      profile.branchId,
      'outstanding',
      query,
    );
  }

  /** Grouped Outstanding aggregate for the dimension panels. */
  @Get('outstanding-summary/grouped')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_OUTSTANDING)
  outstandingSummaryGrouped(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingGroupedQueryDto,
  ) {
    return this.orderService.billingSummaryGrouped(
      tenantId,
      profile.branchId,
      'outstanding',
      query.groupBy,
      query,
    );
  }

  // ── Finance → Reports → Refund (orders with a REFUND ledger entry) ──
  // Reuses the shared billing layer with `report:'refund'`; the summary/records
  // carry the `refundAmount` figure (Σ of REFUND rows). Declared before `:id`.

  /** Refund metric-card totals (incl. `refundAmount`). */
  @Get('refund-summary')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_REFUND)
  refundSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingSummary(
      tenantId,
      profile.branchId,
      'refund',
      query.dimension ?? 'all',
      query,
    );
  }

  /** Paginated detailed Refund records (every row has a refund). */
  @Get('refund-records')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_REFUND)
  refundRecords(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingRecords(
      tenantId,
      profile.branchId,
      'refund',
      query.dimension ?? 'all',
      query,
    );
  }

  /** User-wise Refund aggregate (grouped by order creator). */
  @Get('refund-summary/by-user')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_REFUND)
  refundSummaryByUser(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListOrdersDto,
  ) {
    return this.orderService.billingSummaryByUser(
      tenantId,
      profile.branchId,
      'refund',
      query,
    );
  }

  /** Grouped Refund aggregate for the dimension panels. */
  @Get('refund-summary/grouped')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_REFUND)
  refundSummaryGrouped(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingGroupedQueryDto,
  ) {
    return this.orderService.billingSummaryGrouped(
      tenantId,
      profile.branchId,
      'refund',
      query.groupBy,
      query,
    );
  }

  // ── Finance → Reports → Cancel (CANCELLED orders) ──
  // Reuses the shared billing layer with `report:'cancel'`; the summary/records
  // carry the `cancelAmount` figure (= Order.cancellationCharge). Before `:id`.

  /** Cancel metric-card totals (incl. `cancelAmount`). */
  @Get('cancel-summary')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_CANCEL)
  cancelSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingSummary(
      tenantId,
      profile.branchId,
      'cancel',
      query.dimension ?? 'all',
      query,
    );
  }

  /** Paginated detailed Cancel records (every row is CANCELLED). */
  @Get('cancel-records')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_CANCEL)
  cancelRecords(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingQueryDto,
  ) {
    return this.orderService.billingRecords(
      tenantId,
      profile.branchId,
      'cancel',
      query.dimension ?? 'all',
      query,
    );
  }

  /** User-wise Cancel aggregate (grouped by order creator). */
  @Get('cancel-summary/by-user')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_CANCEL)
  cancelSummaryByUser(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListOrdersDto,
  ) {
    return this.orderService.billingSummaryByUser(
      tenantId,
      profile.branchId,
      'cancel',
      query,
    );
  }

  /** Grouped Cancel aggregate for the dimension panels. */
  @Get('cancel-summary/grouped')
  @RequirePermission(PERMISSION_KEYS.FIN_REPORT_CANCEL)
  cancelSummaryGrouped(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BillingGroupedQueryDto,
  ) {
    return this.orderService.billingSummaryGrouped(
      tenantId,
      profile.branchId,
      'cancel',
      query.groupBy,
      query,
    );
  }

  /** Fetch one order fully composed. */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.orderService.findById(id, tenantId);
  }

  /**
   * List an order's notes (Order Overview → Order / Sample / Tech tabs),
   * newest-first. Omit `category` for all three; the SAMPLE stream also merges
   * the order's read-only accession sample notes.
   */
  @Get(':id/notes')
  findNotes(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() query: ListOrderNotesDto,
  ) {
    return this.orderService.findNotes(id, tenantId, query);
  }

  /** Add a note to an order (append-only — never overwrites existing notes). */
  @Post(':id/notes')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.CREATE,
    description: 'Added an order/sample/tech note',
  })
  createNote(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CreateOrderNoteDto,
  ) {
    return this.orderService.createNote(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * Render one of the order's documents (order slip / bill / TRF / quotation) to a
   * PDF using the selected `PdfReportTemplate`, and stream it back
   * (`application/pdf`). Uses a library-specific response so the
   * `ResponseInterceptor` does not wrap the binary in the JSON envelope — mirrors
   * `PdfReportTemplateController.generate` / `LabReportController.print`.
   */
  @Post(':id/print')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.OTHER,
    description: 'Printed an order document',
  })
  async print(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: PrintOrderDto,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.orderService.print(
      id,
      tenantId,
      dto.type,
      dto.templateId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${dto.type}-${id}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /**
   * "Share and Inform" (Billings): preload the popup — patient + panel contacts
   * and which of Email/WhatsApp (+ IAM) the tenant has activated an
   * `order_bill_as_attachment` template for. Declared before `:id` handlers by
   * path depth (`orders/:id/bill-share-info`).
   */
  @Get(':id/bill-share-info')
  billShareInfo(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.orderService.getBillShareInfo(id, tenantId, profile.branchId);
  }

  /**
   * "Share Bill" (single channel): queue the order's `accounts_biling` bill PDF to
   * the patient or referral panel over Email/WhatsApp using the tenant's activated
   * `order_bill_as_attachment` template.
   */
  @Post(':id/share-bill')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Shared an order bill with the patient/panel',
  })
  shareBill(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderChannelDto,
  ) {
    return this.orderService.shareBill(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /**
   * "Share Bill All": send the bill to the chosen recipient over Email + WhatsApp
   * AND raise the in-app (IAM) notification to the order creator + referral
   * parties. Returns a per-channel result summary (a channel with no activated
   * template is skipped, not an error).
   */
  @Post(':id/share-bill-all')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Shared an order bill with the patient/panel on all channels',
  })
  shareBillAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderAllDto,
  ) {
    return this.orderService.shareBillAll(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  // ── Quotation share (feature lab_quotation_as_attachment; Send All → patient + panel) ──

  /** Preload the Quotations "Share and Inform" popup. */
  @Get(':id/quote-share-info')
  quoteShareInfo(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.orderService.getQuoteShareInfo(id, tenantId, profile.branchId);
  }

  /** Resend the quotation PDF over one channel to the patient or referral panel. */
  @Post(':id/share-quote')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Shared a lab quotation with the patient/panel',
  })
  shareQuote(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderChannelDto,
  ) {
    return this.orderService.shareQuote(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /** Resend the quotation over Email + WhatsApp to the patient AND panel, + IAM. */
  @Post(':id/share-quote-all')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description:
      'Shared a lab quotation with the patient + panel on all channels',
  })
  shareQuoteAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderAllDto,
  ) {
    return this.orderService.shareQuoteAll(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  // ── Appointment-confirmation share (feature lab_create_appointment_inform_patient; no PDF) ──

  /** Preload the Appointments "Share and Inform" popup. */
  @Get(':id/appointment-share-info')
  appointmentShareInfo(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.orderService.getAppointmentShareInfo(
      id,
      tenantId,
      profile.branchId,
    );
  }

  /** Send the appointment confirmation to the patient over one channel (SMS/Email/WhatsApp). */
  @Post(':id/share-appointment')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Shared an appointment confirmation with the patient',
  })
  shareAppointment(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderChannelDto,
  ) {
    return this.orderService.shareAppointment(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /** Send the appointment confirmation to the patient over SMS + Email + WhatsApp, + IAM. */
  @Post(':id/share-appointment-all')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description:
      'Shared an appointment confirmation with the patient on all channels',
  })
  shareAppointmentAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderAllDto,
  ) {
    return this.orderService.shareAppointmentAll(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  // ── TRF share (Accession pages; feature reuses order_bill_as_attachment, trf_print PDF) ──

  /** Preload the Accession "Share and Inform" popup (patient/panel contacts + activated channels). */
  @Get(':id/trf-share-info')
  trfShareInfo(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.orderService.getTrfShareInfo(id, tenantId, profile.branchId);
  }

  /** Share the order's TRF PDF over one channel to the patient or referral panel. */
  @Post(':id/share-trf')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Shared an order TRF with the patient/panel',
  })
  shareTrf(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderChannelDto,
  ) {
    return this.orderService.shareTrf(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /** Share the order's TRF over Email + WhatsApp to the chosen recipient, + IAM. */
  @Post(':id/share-trf-all')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Shared an order TRF with the patient/panel on all channels',
  })
  shareTrfAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareOrderAllDto,
  ) {
    return this.orderService.shareTrfAll(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /** Update an order (scalars, items replacement, section upserts). */
  @Patch(':id')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Updated an order',
  })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    const ctx = {
      tenantId,
      personId,
      branchId: profile.branchId,
      profileKey: profile.profileKey,
    };
    // "Update order ID": enforced only when the incoming external order id
    // actually CHANGES the stored value (echoing an unchanged / disabled field
    // is never blocked). Creation-time id entry is governed by the branch's
    // External-ID format config, not this permission.
    if (dto.externalOrderId !== undefined) {
      const incoming = dto.externalOrderId?.trim() || null;
      const current = await this.orderService.getExternalOrderId(id, tenantId);
      if (incoming !== current) {
        await this.permissionCheck.assert(
          ctx,
          PERMISSION_KEYS.REG_UPDATE_ORDER_ID,
        );
      }
    }
    // Money-field permissions: only enforced when the caller actually RAISES a
    // discount/TDS or CHANGES the paid amount vs the stored order (resending an
    // unchanged, disabled-field value is never blocked).
    const money = this.incomingMoney(dto);
    if (money) {
      const base = await this.orderService.getMoneyAggregate(id, tenantId);
      const EPS = 0.01;
      if (money.discount > base.discount + EPS) {
        await this.permissionCheck.assert(
          ctx,
          PERMISSION_KEYS.REG_ORDER_DISCOUNT,
        );
      }
      if (money.tds > base.tds + EPS) {
        await this.permissionCheck.assert(ctx, PERMISSION_KEYS.REG_ALLOW_TDS);
      }
      if (Math.abs(money.paid - base.paid) > EPS) {
        await this.permissionCheck.assert(
          ctx,
          PERMISSION_KEYS.REG_UPDATE_PAID_AMOUNT,
        );
      }
    }
    return this.orderService.update(id, tenantId, personId, dto);
  }

  /**
   * Mark one order item's sample as collected (idempotent). Also transitions the
   * item's linked accession sample(s) to COLLECTED and stamps sibling tube-mates;
   * `?print=true` additionally assigns a barcode ("Collect & Print").
   */
  @Patch(':id/items/:itemId/collect')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Collected an order item sample',
  })
  collectItem(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Query() query: CollectOrderItemDto,
  ) {
    return this.orderService.collectItem(id, itemId, tenantId, personId, {
      print: query.print,
    });
  }

  /**
   * Collect a whole **group** of the order's accession samples at once — the
   * group-wise counterpart of the per-item collect, backing the Product Overview
   * modal's grouped Test Details (`{ sampleIds, print }`). Transitions every
   * collectable sample in the group to COLLECTED (idempotent) and stamps sibling
   * order items; `print` also assigns a barcode ("Collect & Print").
   */
  @Post(':id/collect-group')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Collected a sample group',
  })
  collectGroup(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CollectGroupDto,
  ) {
    return this.orderService.collectGroup(
      id,
      dto.sampleIds,
      tenantId,
      personId,
      {
        print: dto.print,
      },
    );
  }

  /**
   * Cancel an order (sets status = CANCELLED). Optionally deducts a cancellation
   * charge and refunds part of the paid amount (cancel-with-refund). Body is
   * optional — an empty body cancels with a 0 charge and no refund.
   */
  @Patch(':id/cancel')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Cancelled an order',
  })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    // Cancel-with-refund and cancel-without-refund are the same endpoint,
    // distinguished by the presence of `dto.refund`.
    await this.permissionCheck.assert(
      {
        tenantId,
        personId,
        branchId: profile.branchId,
        profileKey: profile.profileKey,
      },
      dto.refund
        ? PERMISSION_KEYS.REG_CANCEL_ORDER_WITH_REFUND
        : PERMISSION_KEYS.REG_CANCEL_ORDER_WITHOUT_REFUND,
    );
    return this.orderService.cancel(id, tenantId, personId, dto);
  }

  /**
   * Refund part of an order's paid amount without cancelling it ("Refund Without
   * Cancellation"). Supports partial/multiple refunds; also tops up refunds on an
   * already-cancelled order. Capped at the order's current refundable balance.
   */
  @Post(':id/refund')
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSION_KEYS.REG_UPDATE_REFUND_AMOUNT)
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Refunded an order',
  })
  refund(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
  ) {
    return this.orderService.refund(id, tenantId, personId, dto);
  }

  /** Soft-delete an order (cascade soft-deletes items, sections, payments). */
  @Delete(':id')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.DELETE,
    description: 'Deleted an order',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.orderService.remove(id, tenantId);
  }
}
