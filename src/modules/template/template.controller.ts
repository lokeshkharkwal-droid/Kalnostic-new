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
import { TemplateService } from './template.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { ListTemplateQueryDto } from './dto/list-template-query.dto';
import { LookupTemplateQueryDto } from './dto/lookup-template-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Template endpoints (business-authenticated; tenant comes from the JWT). One
 * controller serves both FE route trees: the scope is derived from the active
 * profile's `branchId` (`@CurrentProfile()`) — null for tenant-level templates
 * (business-admin), the active branch for branch-level templates (branch-admin).
 * The branch is never taken from the body (CLAUDE.md §4.7). The global
 * `JwtAuthGuard` protects all routes.
 */
@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  /**
   * Create a template in the caller's scope.
   */
  @Post()
  @Audit({
    module: AuditModule.TEMPLATE,
    action: AuditAction.CREATE,
    description: 'Created a template',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templateService.create(
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /**
   * List templates in the caller's scope (paginated; optional type tab, name
   * search, and status filters).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListTemplateQueryDto,
  ) {
    return this.templateService.findAll(
      tenantId,
      profile.branchId,
      query.page ?? 1,
      query.limit ?? 20,
      { type: query.type, search: query.search, isActive: query.isActive },
    );
  }

  /**
   * Partial, dropdown-optimised listing — returns only `{ id, name }` per row,
   * scoped to the caller's tenant + active branch. Declared before `:id` so the
   * literal `lookup` segment is not captured as a template id.
   */
  @Get('lookup')
  lookup(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: LookupTemplateQueryDto,
  ) {
    return this.templateService.lookup(
      tenantId,
      profile.branchId,
      query.page ?? 1,
      query.limit ?? 20,
      query.type,
    );
  }

  /**
   * Fetch one template by id.
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.templateService.findById(id, tenantId, profile.branchId);
  }

  /**
   * Update a template.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.TEMPLATE,
    action: AuditAction.UPDATE,
    description: 'Updated a template',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templateService.update(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /**
   * Soft-delete a template.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.TEMPLATE,
    action: AuditAction.DELETE,
    description: 'Deleted a template',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.templateService.remove(id, tenantId, profile.branchId);
  }

  /**
   * Duplicate a template within the caller's scope.
   */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.TEMPLATE,
    action: AuditAction.CREATE,
    description: 'Duplicated a template',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.templateService.duplicate(
      id,
      tenantId,
      profile.branchId,
      personId,
    );
  }
}
