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
import { BranchService } from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Branch endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  /**
   * Create a branch in the caller's tenant.
   */
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateBranchDto) {
    return this.branchService.create(tenantId, dto);
  }

  /**
   * List branches in the caller's tenant (paginated).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.branchService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Fetch one branch by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.branchService.findById(id, tenantId);
  }

  /**
   * Update a branch.
   */
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a branch.
   */
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.branchService.remove(id, tenantId);
  }
}
