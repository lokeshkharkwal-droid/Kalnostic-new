import {
  BadRequestException,
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
import { RadiologyMasterDataService } from './radiology-master-data.service';
import { CreateRadiologyMasterDataDto } from './dto/create-radiology-master-data.dto';
import { UpdateRadiologyMasterDataDto } from './dto/update-radiology-master-data.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListRadiologyMasterDataQueryDto } from './dto/list-radiology-master-data-query.dto';
import { ImportFromRadiologyMasterDataQueryDto } from './dto/import-from-radiology-master-data-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology master-data endpoints (business-authenticated; tenant from the JWT).
 * Mirrors the Lab master-data controller. Radiology tests inside a master data
 * live under `/radiology-tests` (the radiology-test module).
 */
@Controller('radiology-master-data')
export class RadiologyMasterDataController {
  constructor(private readonly masterDataService: RadiologyMasterDataService) {}

  /**
   * Manually create a radiology master data for a (non-main) branch.
   */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Created a radiology master data',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateRadiologyMasterDataDto,
  ) {
    return this.masterDataService.create(tenantId, dto);
  }

  /**
   * List the tenant's radiology master data (paginated, optional name `search`
   * and `branchId` filter).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListRadiologyMasterDataQueryDto,
  ) {
    return this.masterDataService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      { search: query.search, branchId: query.branchId },
    );
  }

  /**
   * Import source — the radiology tests of the master data mapped to the active
   * branch. 404 if no master data is mapped to the branch.
   */
  @Get('import/tests')
  importTests(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportFromRadiologyMasterDataQueryDto,
  ) {
    return this.masterDataService.getImportableTests(
      query.branchId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
      {
        department: query.department,
        category: query.category,
        subCategory: query.subCategory,
      },
      query.excludeListId,
    );
  }

  /**
   * Import source — the radiology panels of the master data mapped to the active
   * branch. Mirrors {@link importTests}.
   */
  @Get('import/panels')
  importPanels(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportFromRadiologyMasterDataQueryDto,
  ) {
    return this.masterDataService.getImportablePanels(
      query.branchId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
      {
        department: query.department,
        category: query.category,
      },
      query.excludeListId,
    );
  }

  /**
   * Resolve (get-or-create) the tenant-level **Tenant Radiology Master Data**
   * singleton. Declared before `:id`.
   */
  @Get('tenant')
  getTenant(@CurrentTenant() tenantId: string) {
    return this.masterDataService.getOrCreateTenantMasterData(tenantId);
  }

  /**
   * Resolve (get-or-create) the active branch's **Branch Radiology Master Data**.
   * The branch comes from the JWT (`active_branch_id`). Declared before `:id`.
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
   * Fetch one radiology master data by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.masterDataService.findById(id, tenantId);
  }

  /**
   * Update a radiology master data's name/description.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology master data',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRadiologyMasterDataDto,
  ) {
    return this.masterDataService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a radiology master data (cascade soft-deletes its tests +
   * children). Blocked for the main branch.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology master data',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.masterDataService.remove(id, tenantId);
  }
}
