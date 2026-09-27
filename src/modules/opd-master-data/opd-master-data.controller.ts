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
import { OpdMasterDataService } from './opd-master-data.service';
import { CreateOpdMasterDataDto } from './dto/create-opd-master-data.dto';
import { UpdateOpdMasterDataDto } from './dto/update-opd-master-data.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListOpdMasterDataQueryDto } from './dto/list-opd-master-data-query.dto';
import { ImportFromOpdMasterDataQueryDto } from './dto/import-from-opd-master-data-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Opd master-data endpoints (business-authenticated; tenant from the JWT).
 * Mirrors the Lab master-data controller. Opd tests inside a master data
 * live under `/opd-tests` (the opd-test module).
 */
@Controller('opd-master-data')
export class OpdMasterDataController {
  constructor(private readonly masterDataService: OpdMasterDataService) {}

  /**
   * Manually create a opd master data for a (non-main) branch.
   */
  @Post()
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Created a opd master data',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateOpdMasterDataDto,
  ) {
    return this.masterDataService.create(tenantId, dto);
  }

  /**
   * List the tenant's opd master data (paginated, optional name `search`
   * and `branchId` filter).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListOpdMasterDataQueryDto,
  ) {
    return this.masterDataService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      { search: query.search, branchId: query.branchId },
    );
  }

  /**
   * Import source — the opd tests of the master data mapped to the active
   * branch. 404 if no master data is mapped to the branch.
   */
  @Get('import/tests')
  importTests(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportFromOpdMasterDataQueryDto,
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
   * Import source — the opd panels of the master data mapped to the active
   * branch. Mirrors {@link importTests}.
   */
  @Get('import/panels')
  importPanels(
    @CurrentTenant() tenantId: string,
    @Query() query: ImportFromOpdMasterDataQueryDto,
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
   * Resolve (get-or-create) the tenant-level **Tenant Opd Master Data**
   * singleton. Declared before `:id`.
   */
  @Get('tenant')
  getTenant(@CurrentTenant() tenantId: string) {
    return this.masterDataService.getOrCreateTenantMasterData(tenantId);
  }

  /**
   * Resolve (get-or-create) the active branch's **Branch Opd Master Data**.
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
   * Fetch one opd master data by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.masterDataService.findById(id, tenantId);
  }

  /**
   * Update a opd master data's name/description.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a opd master data',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOpdMasterDataDto,
  ) {
    return this.masterDataService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a opd master data (cascade soft-deletes its tests +
   * children). Blocked for the main branch.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Deleted a opd master data',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.masterDataService.remove(id, tenantId);
  }
}
