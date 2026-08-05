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
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import type { Response } from 'express';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import { ListOrderNotesDto } from './dto/list-order-notes.dto';
import { PrintOrderDto } from './dto/print-order.dto';
import { CollectOrderItemDto } from './dto/collect-order-item.dto';
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
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /** Create an order (with items, sections, and payments) in one call. */
  @Post()
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.CREATE,
    description: 'Created an order',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.orderService.create(tenantId, profile.branchId, personId, dto);
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

  /** Update an order (scalars, items replacement, section upserts). */
  @Patch(':id')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Updated an order',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
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

  /** Cancel an order (sets status = CANCELLED). No refund handling this phase. */
  @Patch(':id/cancel')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Cancelled an order',
  })
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.orderService.cancel(id, tenantId, personId);
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
