import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { BranchService } from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { SetMainBranchDto } from './dto/set-main-branch.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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

  // ── Main-branch routes ──────────────────────────────────────────────────────
  // ROUTE-ORDERING INVARIANT: these literal `main-branch` paths MUST stay above
  // the `:id` param routes below. Express matches per-verb in declaration order,
  // so moving `@Get(':id')` above `@Get('main-branch')` (or adding e.g.
  // `@Patch('main-branch')` below `@Patch(':id')`) would make Nest treat
  // "main-branch" as a branch id and 404. Keep new literal routes here.

  /**
   * Get the tenant's current main branch.
   */
  @Get('main-branch')
  getMainBranch(@CurrentTenant() tenantId: string) {
    return this.branchService.getMainBranch(tenantId);
  }

  /**
   * Set (or change) the tenant's main branch.
   */
  @Put('main-branch')
  setMainBranch(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SetMainBranchDto,
  ) {
    return this.branchService.setMainBranch(tenantId, dto.branchId, personId);
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
