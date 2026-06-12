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
import { LabPanelService } from './lab-panel.service';
import { CreateLabPanelDto } from './dto/create-lab-panel.dto';
import { UpdateLabPanelDto } from './dto/update-lab-panel.dto';
import { ListLabPanelsDto } from './dto/list-lab-panels.dto';
import { BulkEditLabPanelsDto } from './dto/bulk-edit-lab-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Lab-panel endpoints, nested under a master data
 * (`/master-data/:masterDataId/lab-panels`). Business-authenticated; tenant comes
 * from the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('master-data/:masterDataId/lab-panels')
export class LabPanelController {
  constructor(private readonly labPanelService: LabPanelService) {}

  /**
   * Create a lab panel (with nested included tests) in a master data.
   */
  @Post()
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a lab panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateLabPanelDto,
  ) {
    return this.labPanelService.create(masterDataId, tenantId, dto);
  }

  /**
   * List the master data's lab panels (paginated, core rows only).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.labPanelService.findAll(
      masterDataId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Listing screen for a master data's lab panels: search (`panelName`/
   * `panelCode`), parent category/department + status filters, paginated by
   * panel. Declared before the `:panelId` routes so `listing` isn't matched as
   * an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListLabPanelsDto,
  ) {
    return this.labPanelService.listForListing(masterDataId, tenantId, query);
  }

  /**
   * Bulk-edit lab panels: apply the same scalar changes to the selected ids.
   * Declared before the `:panelId` routes so `bulk` isn't matched as an id.
   */
  @Patch('bulk')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited lab panels',
  })
  bulkEdit(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: BulkEditLabPanelsDto,
  ) {
    return this.labPanelService.bulkEdit(masterDataId, tenantId, dto);
  }

  /**
   * Fetch one lab panel composed with its included tests.
   */
  @Get(':panelId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.labPanelService.findById(masterDataId, panelId, tenantId);
  }

  /**
   * Update a lab panel (and replace its included-test set when provided).
   */
  @Patch(':panelId')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a lab panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
    @Body() dto: UpdateLabPanelDto,
  ) {
    return this.labPanelService.update(masterDataId, panelId, tenantId, dto);
  }

  /**
   * Soft-delete a lab panel (cascade soft-deletes its included tests).
   */
  @Delete(':panelId')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.DELETE,
    description: 'Deleted a lab panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.labPanelService.remove(masterDataId, panelId, tenantId);
  }
}
