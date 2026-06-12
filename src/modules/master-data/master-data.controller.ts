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
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
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
   * List the tenant's master data (paginated).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.masterDataService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
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
