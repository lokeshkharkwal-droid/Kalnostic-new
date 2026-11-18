import { Controller, Get, Query } from '@nestjs/common';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';
import { SearchSampleQueryDto } from './dto/search-sample.dto';
import { SampleSearchService } from './sample-search.service';

/**
 * Sample Search popup (In-House, Internal Referral and External Referral Orders): find a barcode and
 * return its sample details and the actions its status allows. Business-authenticated; tenant from
 * the JWT, branch from the active profile. Read-only: the actions themselves run through the
 * existing accession and transfer routes.
 */
@Controller('accession/sample-search')
export class SampleSearchController {
  constructor(private readonly searchService: SampleSearchService) {}

  /**
   * Find a barcode in a menu. A barcode with nothing in the menu is answered with `found: false` and
   * the other menus that have it (not an error, so the screen can show it inline).
   */
  @Get()
  search(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: SearchSampleQueryDto,
  ) {
    // Samples belong to a branch: a profile without an active branch (e.g. the business admin) has nothing to search.
    if (!profile.branchId) throw new ActiveBranchRequiredException();
    return this.searchService.search(
      tenantId,
      profile.branchId,
      personId,
      query,
    );
  }
}
