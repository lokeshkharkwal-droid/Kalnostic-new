import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantTimeZoneService } from './tenant-timezone.service';

/**
 * Lightweight module exposing only {@link TenantTimeZoneService} (which depends on
 * `PrismaService` alone). Kept separate from the heavyweight `TenantModule` — with
 * its controllers and auth/branch/location/exchange imports — so the appointment,
 * slot, collection and communication modules can resolve a tenant's time zone
 * without pulling in that graph (and without risking a circular import).
 */
@Module({
  imports: [PrismaModule],
  providers: [TenantTimeZoneService],
  exports: [TenantTimeZoneService],
})
export class TenantTimeZoneModule {}
