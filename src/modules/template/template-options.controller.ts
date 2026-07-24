import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { TemplateService } from './template.service';
import { ListTemplateQueryDto } from './dto/list-template-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Business-side messaging-template endpoints for browsing the SITE_ADMIN global
 * catalogue (`GET /templates/global`) and cloning one into the caller's scope
 * (`POST /templates/global/:id/clone`). Business-authenticated; tenant + active
 * branch come from the JWT (global `JwtAuthGuard`), never the body (§4.7).
 *
 * Registered BEFORE `TemplateController` in the module so the literal `global`
 * segment is matched here and not captured by that controller's `GET /:id`.
 */
@Controller('templates')
export class TemplateOptionsController {
  constructor(private readonly templateService: TemplateService) {}

  /**
   * Browse active SITE_ADMIN global messaging templates (read-only) so the
   * tenant can pick one to import. Same filter set as the tenant list.
   */
  @Get('global')
  findGlobal(@Query() query: ListTemplateQueryDto) {
    return this.templateService.findAllGlobal(
      query.page ?? 1,
      query.limit ?? 20,
      {
        preference: query.preference,
        feature: query.feature,
        messageType: query.messageType,
        level: query.level,
        applicableBranchType: query.applicableBranchType,
        search: query.search,
        isActive: query.isActive,
        isEnabled: query.isEnabled,
        isDefault: query.isDefault,
      },
    );
  }

  /**
   * Clone a SITE_ADMIN global messaging template into the caller's scope
   * (tenant + active branch). Idempotent — a template already imported into the
   * same scope returns the existing copy.
   */
  @Post('global/:id/clone')
  @Audit({
    module: AuditModule.TEMPLATE,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin messaging template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.templateService.cloneToTenant(
      id,
      tenantId,
      profile.branchId,
      personId,
    );
  }
}
