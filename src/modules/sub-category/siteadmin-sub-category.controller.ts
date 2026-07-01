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
import { SubCategoryService } from './sub-category.service';
import { CreateSubCategoryTemplateDto } from './dto/create-sub-category-template.dto';
import { UpdateSubCategoryTemplateDto } from './dto/update-sub-category-template.dto';
import { ListSubCategoryQueryDto } from './dto/list-sub-category-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin global sub-category **template** management
 * (`/siteadmin/sub-categories`). Templates carry `source = SITE_ADMIN` and no
 * tenant; UNDER_DEPARTMENT / UNDER_CATEGORY templates reference a SITE_ADMIN
 * department / category template. Businesses adopt them by cloning (see
 * `SubCategoryOptionsController`).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/sub-categories')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminSubCategoryController {
  constructor(private readonly subCategoryService: SubCategoryService) {}

  /**
   * Create a global template sub-category.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateSubCategoryTemplateDto) {
    return this.subCategoryService.createTemplate(dto);
  }

  /**
   * List global template sub-categories (paginated; search + type + status + parent).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListSubCategoryQueryDto) {
    return this.subCategoryService.findAllTemplates(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        subCategoryType: query.subCategoryType,
        status: query.status,
        departmentId: query.departmentId,
        categoryId: query.categoryId,
      },
    );
  }

  /**
   * Fetch one global template sub-category.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.subCategoryService.findTemplateById(id);
  }

  /**
   * Update a global template sub-category (`code` is immutable).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateSubCategoryTemplateDto) {
    return this.subCategoryService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template sub-category.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.subCategoryService.removeTemplate(id);
  }
}
