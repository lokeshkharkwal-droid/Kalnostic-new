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
import { LabAdapterService } from './lab-adapter.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CreateLabAdapterDto } from './dto/create-lab-adapter.dto';
import { UpdateLabAdapterDto } from './dto/update-lab-adapter.dto';
import { ListLabAdapterQueryDto } from './dto/list-lab-adapter-query.dto';

/**
 * Lab Adapter endpoints (`/lab-adapters`) — a tenant's instrument-integration
 * bridges. Business-authenticated; the global `JwtAuthGuard` protects all routes.
 * Tenant comes from the JWT (`@CurrentTenant`) and the actor from
 * `@CurrentUser('person_id')` — never from the body (CLAUDE.md §4.7). Writes are
 * audited (`@Audit`). Controllers stay thin — all logic lives in the service.
 */
@Controller('lab-adapters')
export class LabAdapterController {
  constructor(private readonly labAdapterService: LabAdapterService) {}

  /**
   * Create a lab adapter with its branch assignments and lab-test mappings.
   */
  @Post()
  @Audit({
    module: AuditModule.LAB_ADAPTER,
    action: AuditAction.CREATE,
    description: 'Created a lab adapter',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateLabAdapterDto,
  ) {
    return this.labAdapterService.create(tenantId, personId, dto);
  }

  /**
   * List the tenant's lab adapters (paginated + search + status).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListLabAdapterQueryDto,
  ) {
    return this.labAdapterService.findAll(tenantId, query);
  }

  /**
   * Fetch one lab adapter composed with equipment, branches, and lab tests.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.labAdapterService.findById(id, tenantId);
  }

  /**
   * Update a lab adapter (branch/lab-test sets replaced when provided).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.LAB_ADAPTER,
    action: AuditAction.UPDATE,
    description: 'Updated a lab adapter',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLabAdapterDto,
  ) {
    return this.labAdapterService.update(id, tenantId, personId, dto);
  }

  /**
   * Soft-delete a lab adapter (cascade soft-delete of its branch/test rows).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.LAB_ADAPTER,
    action: AuditAction.DELETE,
    description: 'Removed a lab adapter',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.labAdapterService.remove(id, tenantId);
  }
}
