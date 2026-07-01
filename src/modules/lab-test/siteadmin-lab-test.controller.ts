import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LabTestService } from './lab-test.service';
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { ListLabTestsDto } from './dto/list-lab-tests.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin global lab-test **template** management
 * (`/siteadmin/lab-tests`). Templates carry `source = SITE_ADMIN` and no
 * tenant/branch/master data — businesses adopt them by cloning (see
 * `LabTestOptionsController`).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Template content is
 * master-data content, so reads require `master-data:read` and writes
 * `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/lab-tests')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminLabTestController {
  constructor(private readonly labTestService: LabTestService) {}

  /**
   * Create a global template lab test (with nested samples + result parameters).
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateLabTestDto,
  ) {
    return this.labTestService.createTemplate(actorId, dto);
  }

  /**
   * List global template lab tests (paginated; search + status filters).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListLabTestsDto) {
    return this.labTestService.findAllTemplates(query);
  }

  /**
   * Fetch one global template lab test with all its children.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.labTestService.findTemplateById(id);
  }

  /**
   * Update a global template lab test (children replaced when provided).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateLabTestDto) {
    return this.labTestService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template lab test (cascade soft-delete of its children).
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.labTestService.removeTemplate(id);
  }
}
