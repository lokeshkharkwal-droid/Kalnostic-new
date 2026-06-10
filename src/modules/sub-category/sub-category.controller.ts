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
import { SubCategoryService } from './sub-category.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Sub-category endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('sub-categories')
export class SubCategoryController {
  constructor(private readonly subCategoryService: SubCategoryService) {}

  /**
   * Create a sub-category in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.SUB_CATEGORY,
    action: AuditAction.CREATE,
    description: 'Created a sub-category',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateSubCategoryDto) {
    return this.subCategoryService.create(tenantId, dto);
  }

  /**
   * List sub-categories in the caller's tenant (paginated).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.subCategoryService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Fetch one sub-category by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.subCategoryService.findById(id, tenantId);
  }

  /**
   * Update a sub-category.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.SUB_CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Updated a sub-category',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubCategoryDto,
  ) {
    return this.subCategoryService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a sub-category.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.SUB_CATEGORY,
    action: AuditAction.DELETE,
    description: 'Deleted a sub-category',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.subCategoryService.remove(id, tenantId);
  }
}
