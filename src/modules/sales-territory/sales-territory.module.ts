import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesTerritoryController } from './sales-territory.controller';
import { SalesTerritoryService } from './sales-territory.service';

/**
 * Sales territory (zone) master module. Exports `SalesTerritoryService` so the
 * lead module can validate a lead's `territoryId` against the caller's branch.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SalesTerritoryController],
  providers: [SalesTerritoryService],
  exports: [SalesTerritoryService],
})
export class SalesTerritoryModule {}
