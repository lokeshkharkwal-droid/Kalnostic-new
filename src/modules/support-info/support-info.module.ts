import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SiteAdminSupportInfoController } from './siteadmin-support-info.controller';
import { SupportInfoService } from './support-info.service';

/**
 * Support-information feature module. Platform-level (no tenant) SiteAdmin global
 * content. No `SiteAdminModule` import is needed — the `jwt-siteadmin` strategy
 * is registered globally and the guard/decorators/constants are plain imports
 * (same as DepartmentModule's SiteAdmin controller).
 */
@Module({
  imports: [PrismaModule],
  controllers: [SiteAdminSupportInfoController],
  providers: [SupportInfoService],
  exports: [SupportInfoService],
})
export class SupportInfoModule {}
