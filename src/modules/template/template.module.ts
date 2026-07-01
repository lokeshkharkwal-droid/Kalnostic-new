import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

/**
 * Template feature module. Tenant-scoped + branch-level — manages a business's
 * SMS / Email / WhatsApp / Consent-Form / Report templates at both the tenant
 * level (business-admin) and the branch level (branch-admin). Imports
 * BranchModule to validate the active scope branch via its exported service
 * (CLAUDE.md rule #3 — never import another service directly).
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
