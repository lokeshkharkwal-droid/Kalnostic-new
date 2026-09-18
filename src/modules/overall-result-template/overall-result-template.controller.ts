import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { OverallResultTemplateService } from './overall-result-template.service';
import { CreateOverallResultTemplateDto } from './dto/create-overall-result-template.dto';
import { UpdateOverallResultTemplateDto } from './dto/update-overall-result-template.dto';
import { ListOverallResultTemplateDto } from './dto/list-overall-result-template.dto';
import { ListOverallResultGroupNamesDto } from './dto/list-overall-result-group-names.dto';

/**
 * Business Settings › Overall Results endpoints (business-authenticated;
 * tenant comes from the JWT). Tenant-wide, not branch-scoped. `GET` routes are
 * open to any authenticated business user; writes require the matching
 * `business_admin:overall_result_template__*` permission key.
 */
@Controller('overall-result-templates')
@UseGuards(PermissionGuard)
export class OverallResultTemplateController {
  constructor(private readonly service: OverallResultTemplateService) {}

  /** Create an Overall Result template. */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BA_ORT_ADD)
  @Audit({
    module: AuditModule.OVERALL_RESULT_TEMPLATE,
    action: AuditAction.CREATE,
    description: 'Created an overall result template',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateOverallResultTemplateDto,
  ) {
    return this.service.create(tenantId, dto, personId);
  }

  /** List templates in the caller's tenant (paginated; optional filters). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListOverallResultTemplateDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  /**
   * Distinct, active group names in the caller's tenant (paginated, optional
   * `search`) — populates the "Overall Result" group picker on a lab test
   * result parameter. Declared before `:id` so it isn't matched as an id.
   */
  @Get('group-names')
  findGroupNames(
    @CurrentTenant() tenantId: string,
    @Query() query: ListOverallResultGroupNamesDto,
  ) {
    return this.service.findDistinctGroupNames(tenantId, query);
  }

  /** Fetch one template by id. */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(id, tenantId);
  }

  /** Update a template. */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.BA_ORT_EDIT)
  @Audit({
    module: AuditModule.OVERALL_RESULT_TEMPLATE,
    action: AuditAction.UPDATE,
    description: 'Updated an overall result template',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOverallResultTemplateDto,
  ) {
    return this.service.update(id, tenantId, dto, personId);
  }

  /** Soft-delete a template. */
  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.BA_ORT_DELETE)
  @Audit({
    module: AuditModule.OVERALL_RESULT_TEMPLATE,
    action: AuditAction.DELETE,
    description: 'Deleted an overall result template',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(id, tenantId);
  }
}
