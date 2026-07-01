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
import { OutsourceCenterService } from './outsource-center.service';
import { CreateOutsourceCenterDto } from './dto/create-outsource-center.dto';
import { UpdateOutsourceCenterDto } from './dto/update-outsource-center.dto';
import { ListOutsourceCentersDto } from './dto/list-outsource-centers.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Outsource-center endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('outsource-centers')
export class OutsourceCenterController {
  constructor(
    private readonly outsourceCenterService: OutsourceCenterService,
  ) {}

  /**
   * Create an outsource center with its contacts and branch assignments.
   */
  @Post()
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.CREATE,
    description: 'Created an outsource center',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateOutsourceCenterDto,
  ) {
    return this.outsourceCenterService.create(tenantId, dto);
  }

  /**
   * List outsource centers in the caller's tenant (paginated). With
   * `?view=contacts`, returns a flat, paginated list of every contact across the
   * tenant's centers instead.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListOutsourceCentersDto,
  ) {
    return this.outsourceCenterService.findAll(tenantId, query);
  }

  /**
   * Fetch one outsource center by id (with contacts and the resolved lab
   * test/panel names).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.outsourceCenterService.findById(id, tenantId);
  }

  /**
   * Update an outsource center (contacts are replace-all when sent). Used for
   * activate/inactivate too, via `{ isActive }`.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.UPDATE,
    description: 'Updated an outsource center',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOutsourceCenterDto,
  ) {
    return this.outsourceCenterService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete an outsource center (cascades to its contacts).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.DELETE,
    description: 'Deleted an outsource center',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.outsourceCenterService.remove(id, tenantId);
  }
}
