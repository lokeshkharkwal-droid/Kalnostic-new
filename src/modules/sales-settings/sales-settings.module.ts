import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesSettingsController } from './sales-settings.controller';
import { SalesSettingsService } from './sales-settings.service';

/**
 * Tenant-level sales settings module (one config blob per tenant). No branch
 * scope and no cross-module dependencies beyond Prisma.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SalesSettingsController],
  providers: [SalesSettingsService],
  exports: [SalesSettingsService],
})
export class SalesSettingsModule {}
