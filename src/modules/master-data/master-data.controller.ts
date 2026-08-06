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
import { MasterDataService } from './master-data.service';
import { CreateMasterDataDto } from './dto/create-master-data.dto';
import { UpdateMasterDataDto } from './dto/update-master-data.dto';
import { BadRequestException } from '@nestjs/common';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListMasterDataQueryDto } from './dto/list-master-data-query.dto';
import { ImportFromMasterDataQueryDto } from './dto/import-from-master-data-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Master-data endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes. There is no "create the default
 * master data" route — it is auto-provisioned when a branch is created. Lab tests
 * inside a master data live under `/master-data/:masterDataId/lab-tests` (the
 * lab-test module).
 */
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  /**
   * Manually create a master data for a (non-main) branch.
   */
  @Post()
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.CREATE,
    description: 'Created a master data',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateMasterDataDto) {
    return this.masterDataService.create(tenantId, dto);
  }

  /**
   * List the tenant's master data (paginated, optional case-insensitive name
   * `search` and `branchId` filter).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListMasterDataQueryDto,
  ) {
    return this.masterDataService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      { search: query.search, branchId: query.branchId },
    );
  }

  /**
   * Import source — the lab tests of the master data mapped to the active
   * branch. The client passes its active `branchId` (from the JWT); the backend
   * resolves that branch's single master data and returns its lab tests for the
   * import picker. 404 if no master data is mapped to the branch.
   */
  @Get('import/lab-tests')
  importLabTests(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportFromMasterDataQueryDto,
  ) {
    return this.masterDataService.getImportableLabTests(
      query.branchId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
    );
  }

  /**
   * Import source — the lab panels of the master data mapped to the active
   * branch. Mirrors {@link importLabTests}.
   */
  @Get('import/lab-panels')
  importLabPanels(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportFromMasterDataQueryDto,
  ) {
    return this.masterDataService.getImportableLabPanels(
      query.branchId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
    );
  }

  /**
   * Resolve (get-or-create) the tenant-level **Tenant Master Data** singleton —
   * the business-admin catalogue that Site Admin imports target. Declared before
   * `:id` so `tenant` isn't captured as an id.
   */
  @Get('tenant')
  getTenant(@CurrentTenant() tenantId: string) {
    return this.masterDataService.getOrCreateTenantMasterData(tenantId);
  }

  /**
   * Resolve (get-or-create) the active branch's **Branch Master Data**. The
   * branch comes from the JWT (`active_branch_id`) — 400 for a tenant-level role
   * with no active branch. Declared before `:id`.
   */
  @Get('branch')
  getBranch(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
  ) {
    if (!branchId) {
      throw new BadRequestException('No active branch in the current context');
    }
    return this.masterDataService.getOrCreateBranchMasterData(
      tenantId,
      branchId,
    );
  }

  /**
   * Fetch one master data by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.masterDataService.findById(id, tenantId);
  }

  /**
   * Update a master data's name/description.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.UPDATE,
    description: 'Updated a master data',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMasterDataDto,
  ) {
    return this.masterDataService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a master data (cascade soft-deletes its lab tests + children).
   * Blocked for the main branch.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.DELETE,
    description: 'Deleted a master data',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.masterDataService.remove(id, tenantId);
  }
}
