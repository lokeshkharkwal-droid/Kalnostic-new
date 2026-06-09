import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Audit feature module. Exports `AuditService` so the global `AuditInterceptor`
 * (and any module that wants to log explicitly, e.g. auth login/logout) can
 * inject it.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
