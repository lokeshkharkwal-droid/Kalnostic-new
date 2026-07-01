import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SiteAdminPaymentRulesController } from './siteadmin-payment-rules.controller';
import { PaymentRulesService } from './payment-rules.service';

/**
 * Payment Rules feature module. Platform-level (SiteAdmin-managed, no tenant
 * RLS — CLAUDE.md §4.6). Exposes SiteAdmin CRUD for commission/tax rules under
 * `/siteadmin/payment-rules`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SiteAdminPaymentRulesController],
  providers: [PaymentRulesService],
  exports: [PaymentRulesService],
})
export class PaymentRulesModule {}
