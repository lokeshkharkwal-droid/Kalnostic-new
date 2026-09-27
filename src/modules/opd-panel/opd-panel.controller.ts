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
import { OpdPanelService } from './opd-panel.service';
import { CreateOpdPanelDto } from './dto/create-opd-panel.dto';
import { UpdateOpdPanelDto } from './dto/update-opd-panel.dto';
import { ListOpdPanelsDto } from './dto/list-opd-panels.dto';
import { BulkEditOpdPanelsDto } from './dto/bulk-edit-opd-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Opd-panel endpoints, nested under a master data
 * (`/opd-master-data/:masterDataId/opd-panels`). Business-authenticated;
 * tenant comes from the JWT.
 */
@Controller('opd-master-data/:masterDataId/opd-panels')
export class OpdPanelController {
  constructor(private readonly opdPanelService: OpdPanelService) {}

  /**
   * Create a opd panel (with nested included tests) in a master data.
   */
  @Post()
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Created a opd panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateOpdPanelDto,
  ) {
    return this.opdPanelService.create(masterDataId, tenantId, dto);
  }

  /**
   * List the master data's opd panels (paginated, core rows only).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.opdPanelService.findAll(
      masterDataId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Listing screen for a master data's opd panels. Declared before the
   * `:panelId` routes so `listing` isn't matched as an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListOpdPanelsDto,
  ) {
    return this.opdPanelService.listForListing(masterDataId, tenantId, query);
  }

  /**
   * Bulk-edit opd panels. Declared before the `:panelId` routes.
   */
  @Patch('bulk')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited opd panels',
  })
  bulkEdit(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: BulkEditOpdPanelsDto,
  ) {
    return this.opdPanelService.bulkEdit(masterDataId, tenantId, dto);
  }

  /**
   * Fetch one opd panel composed with its included tests.
   */
  @Get(':panelId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.opdPanelService.findById(masterDataId, panelId, tenantId);
  }

  /**
   * Update a opd panel (and replace its included-test set when provided).
   */
  @Patch(':panelId')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a opd panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
    @Body() dto: UpdateOpdPanelDto,
  ) {
    return this.opdPanelService.update(masterDataId, panelId, tenantId, dto);
  }

  /**
   * Soft-delete a opd panel (cascade soft-deletes its included tests).
   */
  @Delete(':panelId')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Deleted a opd panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.opdPanelService.remove(masterDataId, panelId, tenantId);
  }
}
