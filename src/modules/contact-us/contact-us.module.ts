import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContactUsController } from './contact-us.controller';
import { SiteAdminContactUsController } from './siteadmin-contact-us.controller';
import { ContactUsService } from './contact-us.service';

/**
 * Contact-us feature module. Platform-level (no tenant) — the public marketing
 * site submits leads via `POST /contact-us` (unauthenticated) and SiteAdmin
 * reviews them under `/siteadmin/contact-us`.
 *
 * No `SiteAdminModule` import is needed — the `jwt-siteadmin` strategy is
 * registered globally and the guard/decorators/constants are plain imports
 * (same as `SupportInfoModule` / `DepartmentModule`'s SiteAdmin controller).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ContactUsController, SiteAdminContactUsController],
  providers: [ContactUsService],
  exports: [ContactUsService],
})
export class ContactUsModule {}
