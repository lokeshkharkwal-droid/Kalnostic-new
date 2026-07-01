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
import { DepartmentService } from './department.service';
import { CreateDepartmentTemplateDto } from './dto/create-department-template.dto';
import { UpdateDepartmentTemplateDto } from './dto/update-department-template.dto';
import { ListDepartmentQueryDto } from './dto/list-department-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin global department **template** management (`/siteadmin/departments`).
 * Templates carry `source = SITE_ADMIN` and no tenant — businesses adopt them by
 * cloning (see `DepartmentOptionsController`).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Templates are
 * master-data content, so reads require `master-data:read` and writes
 * `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/departments')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminDepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  /**
   * Create a global template department.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateDepartmentTemplateDto) {
    return this.departmentService.createTemplate(dto);
  }

  /**
   * List global template departments (paginated; search + status + moduleMapping).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListDepartmentQueryDto) {
    return this.departmentService.findAllTemplates(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        status: query.status,
        moduleMapping: query.moduleMapping,
      },
    );
  }

  /**
   * Fetch one global template department.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.departmentService.findTemplateById(id);
  }

  /**
   * Update a global template department (`code` is immutable).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentTemplateDto) {
    return this.departmentService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template department.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.departmentService.removeTemplate(id);
  }
}
