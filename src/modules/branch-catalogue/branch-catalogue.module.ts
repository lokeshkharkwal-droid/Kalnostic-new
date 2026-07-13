import { Module } from '@nestjs/common';
import { BranchCatalogueService } from './branch-catalogue.service';
import { BranchTypesController } from './branch-types.controller';
import { ModulesController } from './modules.controller';

/**
 * Branch-catalogue feature module — serves branch types and their modules from
 * a config constant (no database). Both endpoints are public.
 */
@Module({
  controllers: [BranchTypesController, ModulesController],
  providers: [BranchCatalogueService],
})
export class BranchCatalogueModule {}
