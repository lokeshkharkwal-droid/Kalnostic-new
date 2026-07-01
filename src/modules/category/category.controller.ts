import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ListCategoryQueryDto } from './dto/list-category-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Category endpoints (business-authenticated; tenant comes from the JWT). The
 * global `JwtAuthGuard` protects all routes.
 */
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * Create a category in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.CATEGORY,
    action: AuditAction.CREATE,
    description: 'Created a category',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCategoryDto) {
    return this.categoryService.create(tenantId, dto);
  }

  /**
   * List categories in the caller's tenant (paginated, optional `search` over
   * name/code, `categoryType` filter, `status` active/inactive filter, and
   * cascading `departmentId` filter).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListCategoryQueryDto,
  ) {
    return this.categoryService.findAllForTenant(
      tenantId,
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
   * Fetch one category by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.categoryService.findById(id, tenantId);
  }

  /**
   * Update a category.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Updated a category',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoryService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a category.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.CATEGORY,
    action: AuditAction.DELETE,
    description: 'Deleted a category',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.categoryService.remove(id, tenantId);
  }
}
