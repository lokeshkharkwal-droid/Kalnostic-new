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
import { SetBranchModulesDto } from './dto/set-branch-modules.dto';
import { SetCollectionMappingsDto } from './dto/set-collection-mappings.dto';
import { AuditAction, AuditModule } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Branch endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  /**
   * Create a branch in the caller's tenant. When the tenant has no active
   * branch yet, the new branch is auto-set as the main branch.
   */
  @Post()
  @Audit({
    module: AuditModule.BRANCH,
    action: AuditAction.CREATE,
    description: 'Created a branch',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchService.create(tenantId, dto, personId);
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
  @Audit({
    module: AuditModule.BRANCH,
    action: AuditAction.UPDATE,
    description: 'Set the main branch',
  })
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
  @Audit({
    module: AuditModule.BRANCH,
    action: AuditAction.UPDATE,
    description: 'Updated a branch',
  })
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
  @Audit({
    module: AuditModule.BRANCH,
    action: AuditAction.DELETE,
    description: 'Deleted a branch',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.branchService.remove(id, tenantId);
  }

  /**
   * List the system modules and whether each is enabled at this branch.
   */
  @Get(':id/modules')
  getModules(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.branchService.getBranchModules(tenantId, id);
  }

  /**
   * Set which system modules are enabled at this branch.
   */
  @Put(':id/modules')
  @Audit({
    module: AuditModule.BRANCH,
    action: AuditAction.UPDATE,
    description: 'Updated branch module enablement',
  })
  setModules(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchModulesDto,
  ) {
    return this.branchService.setBranchModules(tenantId, id, dto.modules);
  }

  /**
   * List the sample-receiving branches mapped to this Collection Center.
   */
  @Get(':id/collection-mappings')
  getCollectionMappings(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.branchService.getCollectionMappings(tenantId, id);
  }

  /**
   * Replace the set of sample-receiving branches mapped to this Collection
   * Center (PUT replaces the whole set; an empty array clears all mappings).
   */
  @Put(':id/collection-mappings')
  @Audit({
    module: AuditModule.BRANCH,
    action: AuditAction.UPDATE,
    description: 'Updated collection center mappings',
  })
  setCollectionMappings(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetCollectionMappingsDto,
  ) {
    return this.branchService.setCollectionMappings(
      tenantId,
      id,
      dto.receivingBranchIds,
      personId,
    );
  }
}
