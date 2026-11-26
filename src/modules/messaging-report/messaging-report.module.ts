import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExchangeModule } from '../communication/exchange/exchange.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { MessagingReportController } from './messaging-report.controller';
import { MessagingReportService } from './messaging-report.service';

/**
 * Business Admin messaging reports (WhatsApp Report / SMS Report), read from the
 * Exchange gateway. Depends only on the leaf `ExchangeModule` (gateway client +
 * tenant → Exchange id resolution) and Prisma (local log enrichment).
 */
@Module({
  imports: [PrismaModule, ExchangeModule, PermissionsModule],
  controllers: [MessagingReportController],
  providers: [MessagingReportService],
  exports: [MessagingReportService],
})
export class MessagingReportModule {}
