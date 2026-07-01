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
import { DepartmentService } from './department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ListDepartmentQueryDto } from './dto/list-department-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Department endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  /**
   * Create a department in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.DEPARTMENT,
    action: AuditAction.CREATE,
    description: 'Created a department',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateDepartmentDto) {
    return this.departmentService.create(tenantId, dto);
  }

  /**
   * List departments in the caller's tenant (paginated, optional `search` over
   * name/code, `status` active/inactive filter, and `moduleMapping` filter).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListDepartmentQueryDto,
  ) {
    return this.departmentService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        status: query.status,
        moduleMapping: query.moduleMapping,
      },
    );
  }

  /**
   * Fetch one department by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.departmentService.findById(id, tenantId);
  }

  /**
   * Update a department.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.DEPARTMENT,
    action: AuditAction.UPDATE,
    description: 'Updated a department',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departmentService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a department.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.DEPARTMENT,
    action: AuditAction.DELETE,
    description: 'Deleted a department',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.departmentService.remove(id, tenantId);
  }
}
