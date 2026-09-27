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
import { RadiologyPanelService } from './radiology-panel.service';
import { CreateRadiologyPanelDto } from './dto/create-radiology-panel.dto';
import { UpdateRadiologyPanelDto } from './dto/update-radiology-panel.dto';
import { ListRadiologyPanelsDto } from './dto/list-radiology-panels.dto';
import { BulkEditRadiologyPanelsDto } from './dto/bulk-edit-radiology-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology-panel endpoints, nested under a master data
 * (`/radiology-master-data/:masterDataId/radiology-panels`). Business-authenticated;
 * tenant comes from the JWT.
 */
@Controller('radiology-master-data/:masterDataId/radiology-panels')
export class RadiologyPanelController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /**
   * Create a radiology panel (with nested included tests) in a master data.
   */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Created a radiology panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateRadiologyPanelDto,
  ) {
    return this.radiologyPanelService.create(masterDataId, tenantId, dto);
  }

  /**
   * List the master data's radiology panels (paginated, core rows only).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.radiologyPanelService.findAll(
      masterDataId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Listing screen for a master data's radiology panels. Declared before the
   * `:panelId` routes so `listing` isn't matched as an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListRadiologyPanelsDto,
  ) {
    return this.radiologyPanelService.listForListing(
      masterDataId,
      tenantId,
      query,
    );
  }

  /**
   * Bulk-edit radiology panels. Declared before the `:panelId` routes.
   */
  @Patch('bulk')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited radiology panels',
  })
  bulkEdit(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: BulkEditRadiologyPanelsDto,
  ) {
    return this.radiologyPanelService.bulkEdit(masterDataId, tenantId, dto);
  }

  /**
   * Fetch one radiology panel composed with its included tests.
   */
  @Get(':panelId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.radiologyPanelService.findById(masterDataId, panelId, tenantId);
  }

  /**
   * Update a radiology panel (and replace its included-test set when provided).
   */
  @Patch(':panelId')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
    @Body() dto: UpdateRadiologyPanelDto,
  ) {
    return this.radiologyPanelService.update(
      masterDataId,
      panelId,
      tenantId,
      dto,
    );
  }

  /**
   * Soft-delete a radiology panel (cascade soft-deletes its included tests).
   */
  @Delete(':panelId')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.radiologyPanelService.remove(masterDataId, panelId, tenantId);
  }
}
