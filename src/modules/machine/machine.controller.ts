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
import { MachineService } from './machine.service';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { ListMachinesDto } from './dto/list-machines.dto';
import { CreateAdapterLogDto } from './dto/create-adapter-log.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Machine Management endpoints (`/machines`). Business-authenticated; tenant comes
 * from the JWT. The global `JwtAuthGuard` protects all routes. Reagent kits, test
 * mappings, and branch assignments are managed inline through the create/update
 * body; adapter logs have their own sub-routes.
 */
@Controller('machines')
export class MachineController {
  constructor(private readonly machineService: MachineService) {}

  /**
   * Create a machine (with nested reagent kits, test mappings, and branch ids).
   */
  @Post()
  @Audit({
    module: AuditModule.MACHINE,
    action: AuditAction.CREATE,
    description: 'Created a machine',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateMachineDto) {
    return this.machineService.create(tenantId, dto);
  }

  /**
   * List the tenant's machines (paginated; search + status + department filters).
   */
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ListMachinesDto) {
    return this.machineService.findAll(tenantId, query);
  }

  /**
   * Fetch one machine composed with its children + branch assignments.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.machineService.findById(id, tenantId);
  }

  /**
   * Update a machine (and replace child / branch sets when provided).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.MACHINE,
    action: AuditAction.UPDATE,
    description: 'Updated a machine',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMachineDto,
  ) {
    return this.machineService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a machine (cascade soft-deletes its children + branch mappings).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.MACHINE,
    action: AuditAction.DELETE,
    description: 'Deleted a machine',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.machineService.remove(id, tenantId);
  }

  /**
   * List a machine's adapter communication logs (paginated, newest first).
   */
  @Get(':id/adapter-logs')
  listAdapterLogs(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.machineService.listAdapterLogs(
      id,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Append an adapter communication log line for a machine.
   */
  @Post(':id/adapter-logs')
  @Audit({
    module: AuditModule.MACHINE,
    action: AuditAction.CREATE,
    description: 'Recorded a machine adapter log',
  })
  appendAdapterLog(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateAdapterLogDto,
  ) {
    return this.machineService.appendAdapterLog(id, tenantId, dto);
  }

  /**
   * Mark a machine's adapter log line as viewed.
   */
  @Patch(':id/adapter-logs/:logId/viewed')
  @Audit({
    module: AuditModule.MACHINE,
    action: AuditAction.UPDATE,
    description: 'Marked a machine adapter log as viewed',
  })
  markLogViewed(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('logId') logId: string,
  ) {
    return this.machineService.markLogViewed(id, logId, tenantId);
  }
}
