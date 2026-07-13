import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { BranchCatalogueService } from './branch-catalogue.service';

/** Public endpoint exposing the available branch types. */
@Controller('branch-types')
export class BranchTypesController {
  constructor(
    private readonly branchCatalogueService: BranchCatalogueService,
  ) {}

  /**
   * Returns the list of all available branch-type names.
   *
   * @returns a string array of branch-type names.
   */
  @Public()
  @Get()
  findAll(): string[] {
    return this.branchCatalogueService.getBranchTypes();
  }
}
