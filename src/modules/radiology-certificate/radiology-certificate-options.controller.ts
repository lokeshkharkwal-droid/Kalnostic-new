import { Controller, Get, Query } from '@nestjs/common';
import { RadiologyCertificateService } from './radiology-certificate.service';
import { RadiologyCertificateOptionsQueryDto } from './dto/radiology-certificate-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Trimmed `{ id, name, groupName }` radiology-certificate options for the active
 * branch (optionally narrowed to a master data / search) — e.g. selecting a
 * certificate to issue. Branch scope comes from the JWT profile.
 */
@Controller('radiology-certificates')
export class RadiologyCertificateOptionsController {
  constructor(private readonly service: RadiologyCertificateService) {}

  @Get('options')
  options(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: RadiologyCertificateOptionsQueryDto,
  ) {
    return this.service.findOptions(tenantId, profile.branchId ?? null, query);
  }
}
