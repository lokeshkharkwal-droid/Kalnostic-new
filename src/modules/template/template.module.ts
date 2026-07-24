import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { TemplateController } from './template.controller';
import { TemplateOptionsController } from './template-options.controller';
import { SiteAdminTemplateController } from './siteadmin-template.controller';
import { TemplateService } from './template.service';

/**
 * Messaging template feature module. Tenant-scoped + branch-level — manages a
 * business's Email / SMS / WhatsApp / IAM / IAA / PBN templates at both the
 * tenant level (business-admin) and the branch level (branch-admin). Imports
 * BranchModule to validate the active scope branch via its exported service
 * (CLAUDE.md rule #3 — never import another service directly).
 *
 * `SiteAdminTemplateController` adds the SiteAdmin-scoped variant
 * (`/siteadmin/templates`) that manages the shared, platform-level global master
 * templates (tenant_id NULL), mirroring `siteadmin/pdf-report-templates`.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [
    TemplateOptionsController,
    TemplateController,
    SiteAdminTemplateController,
  ],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
