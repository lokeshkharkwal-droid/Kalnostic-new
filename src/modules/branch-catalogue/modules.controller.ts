import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import {
  BranchCatalogueService,
  CatalogueModule,
} from './branch-catalogue.service';
import { ListModulesQueryDto } from './dto/list-modules-query.dto';

/** Public endpoint exposing modules, optionally filtered by branch type. */
@Controller('modules')
export class ModulesController {
  constructor(
    private readonly branchCatalogueService: BranchCatalogueService,
  ) {}

  /**
   * Returns modules. With no `branch_type` param, returns the de-duplicated
   * union of modules across all branch types; with a `branch_type`, returns
   * that type's modules.
   *
   * @param query optional `branch_type` filter (snake_case).
   * @returns the modules as `{ key, label }` objects.
   * @throws InvalidBranchTypeException if `branch_type` is supplied but unknown.
   */
  @Public()
  @Get()
  findAll(@Query() query: ListModulesQueryDto): CatalogueModule[] {
    if (query.branch_type !== undefined) {
      return this.branchCatalogueService.getModulesForBranchType(
        query.branch_type,
      );
    }
    return this.branchCatalogueService.getAllModules();
  }
}
