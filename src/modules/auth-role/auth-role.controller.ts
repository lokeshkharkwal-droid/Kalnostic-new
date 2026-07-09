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
import { AuthRoleService } from './auth-role.service';
import { CreateAuthRoleDto } from './dto/create-auth-role.dto';
import { UpdateAuthRoleDto } from './dto/update-auth-role.dto';
import { ListAuthRolesQueryDto } from './dto/list-auth-roles-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Role endpoints (business-authenticated; tenant comes from the JWT). Lists the
 * tenant's own custom roles plus the global system roles; only custom roles can
 * be created/deleted, and system roles are read-only apart from
 * `description`/`isActive`. The global `JwtAuthGuard` protects all routes.
 */
@Controller('roles')
export class AuthRoleController {
  constructor(private readonly authRoleService: AuthRoleService) {}

  /**
   * Create a custom role in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.AUTH,
    action: AuditAction.CREATE,
    description: 'Created a custom role',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateAuthRoleDto) {
    return this.authRoleService.create(tenantId, dto);
  }

  /**
   * List roles visible to the caller's tenant (system + custom), paginated, with
   * optional `search`, `status`, and `scope` filters.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListAuthRolesQueryDto,
  ) {
    return this.authRoleService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      { search: query.search, status: query.status, scope: query.scope },
    );
  }

  /**
   * Fetch one role by id (custom role of this tenant, or a system role).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.authRoleService.findById(tenantId, id);
  }

  /**
   * Update a role. System roles accept only `description`/`isActive`.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.AUTH,
    action: AuditAction.UPDATE,
    description: 'Updated a role',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAuthRoleDto,
  ) {
    return this.authRoleService.update(tenantId, id, dto);
  }

  /**
   * Soft-delete a custom role (system roles and in-use roles are refused).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.AUTH,
    action: AuditAction.DELETE,
    description: 'Deleted a custom role',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.authRoleService.remove(tenantId, id);
  }
}
