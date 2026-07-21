import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

/**
 * Pricing feature module. Tenant-scoped + branch-level. Reads branch lab
 * test/panel prices via Prisma directly to compute a Create-Order price preview.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
