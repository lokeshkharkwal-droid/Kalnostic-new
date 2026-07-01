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
import { CategoryService } from './category.service';
import { CreateCategoryTemplateDto } from './dto/create-category-template.dto';
import { UpdateCategoryTemplateDto } from './dto/update-category-template.dto';
import { ListCategoryQueryDto } from './dto/list-category-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin global category **template** management (`/siteadmin/categories`).
 * Templates carry `source = SITE_ADMIN` and no tenant; UNDER_DEPARTMENT
 * templates reference a SITE_ADMIN department template. Businesses adopt them by
 * cloning (see `CategoryOptionsController`).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/categories')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminCategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * Create a global template category.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateCategoryTemplateDto) {
    return this.categoryService.createTemplate(dto);
  }

  /**
   * List global template categories (paginated; search + type + status + parent).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListCategoryQueryDto) {
    return this.categoryService.findAllTemplates(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        categoryType: query.categoryType,
        status: query.status,
        departmentId: query.departmentId,
      },
    );
  }

  /**
   * Fetch one global template category.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.categoryService.findTemplateById(id);
  }

  /**
   * Update a global template category (`code` is immutable).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateCategoryTemplateDto) {
    return this.categoryService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template category.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.categoryService.removeTemplate(id);
  }
}
