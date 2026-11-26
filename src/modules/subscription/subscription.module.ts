import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionClient } from './subscription.client';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionUsageService } from './subscription-usage.service';
import { SubscriptionUsageController } from './subscription-usage.controller';
import { SubscriptionApiKeyGuard } from './guards/subscription-api-key.guard';

/**
 * Subscription module — the single seam Kalnostics uses to talk to the external
 * subscription microservice. Two directions:
 *  - **Outbound** (`SubscriptionController` / `SubscriptionService` / `SubscriptionClient`):
 *    proxies the business-admin Subscription Plan screen (register / plans /
 *    change-plan / bills). Kalnostics stores no subscription data.
 *  - **Inbound** (`SubscriptionUsageController` / `SubscriptionUsageService`): the
 *    usage-reporting API the subscription scheduler calls per business to pull
 *    daily/monthly tenant usage metrics (ported from EzHealthTrack), guarded by
 *    the shared `key`/`secret` (`SubscriptionApiKeyGuard`).
 *
 * Safe `SUBSCRIPTION_NOT_CONFIGURED` error (outbound) / 401 (inbound) when the
 * `SUBSCRIPTION_API_*` config is unset.
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [SubscriptionController, SubscriptionUsageController],
  providers: [
    SubscriptionClient,
    SubscriptionService,
    SubscriptionUsageService,
    SubscriptionApiKeyGuard,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
