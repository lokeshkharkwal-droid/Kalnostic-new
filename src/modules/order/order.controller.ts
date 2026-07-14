import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
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
    @Body() dto: CreateOrderDto,
  ) {
    return this.orderService.create(tenantId, profile.branchId, dto);
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

  /** Update an order (scalars, items replacement, section upserts). */
  @Patch(':id')
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Updated an order',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orderService.update(id, tenantId, dto);
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
