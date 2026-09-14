import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ExchangeClient } from './exchange.client';
import { ExchangeRegistrationService } from './exchange-registration.service';

/**
 * Leaf module that owns ALL transport to the external Exchange server: the
 * shared `ExchangeClient` (notifications + `/clients` registration) and the
 * `ExchangeRegistrationService`. Kept dependency-light (only `PrismaModule`;
 * `ConfigService` is global) so both `CommunicationModule` (message sending) and
 * `TenantModule` (SiteAdmin registration endpoints) can import it without any
 * circular dependency.
 */
@Module({
  imports: [PrismaModule],
  providers: [ExchangeClient, ExchangeRegistrationService],
  exports: [ExchangeClient, ExchangeRegistrationService],
})
export class ExchangeModule {}
