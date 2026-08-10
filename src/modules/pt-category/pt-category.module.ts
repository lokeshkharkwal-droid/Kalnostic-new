import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PtCategoryController } from './pt-category.controller';
import { PtCategoryOptionsController } from './pt-category-options.controller';
import { PtCategoryService } from './pt-category.service';

/**
 * PT (Patient) Category feature module (Registration Settings). Tenant-scoped +
 * branch-level — each category belongs to one branch and maps to at most one
 * branch Lab Test / Lab Panel. Auto-provisions a "General" default per branch on
 * the `branch.created` event (listener on `PtCategoryService`). Exports the
 * service so the referral-list resolver can inject it (rule #3) to fold PT
 * Category into the order pricing chain. Mapping validation is a plain scoped
 * existence check via `PrismaService` (no cross-module service dependency).
 * `PtCategoryOptionsController` is listed first so `/pt-categories/options`
 * matches before `/pt-categories/:id`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PtCategoryOptionsController, PtCategoryController],
  providers: [PtCategoryService],
  exports: [PtCategoryService],
})
export class PtCategoryModule {}
