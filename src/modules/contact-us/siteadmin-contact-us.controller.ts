import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContactUsService } from './contact-us.service';
import { ListContactSubmissionQueryDto } from './dto/list-contact-submission-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin contact-us inbox (`/siteadmin/contact-us`). Submissions are
 * platform-level (no tenant) leads captured by the public form.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Leads are
 * business/operations data, so reads require `business:read` and the destructive
 * delete requires `business:suspend` (operations_admin and above) — reusing the
 * closest existing SiteAdmin permissions.
 */
@Controller('siteadmin/contact-us')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminContactUsController {
  constructor(private readonly contactUsService: ContactUsService) {}

  /**
   * List contact submissions (paginated; `search` over name/mobile/email,
   * `from`/`to` date range).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findAll(@Query() query: ListContactSubmissionQueryDto) {
    return this.contactUsService.findAll(query);
  }

  /**
   * Fetch one contact submission (full record).
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findOne(@Param('id') id: string) {
    return this.contactUsService.findById(id);
  }

  /**
   * Soft-delete a contact submission.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_SUSPEND)
  remove(@Param('id') id: string) {
    return this.contactUsService.remove(id);
  }
}
