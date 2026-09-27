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
import { OpdTestService } from './opd-test.service';
import { CreateOpdTestDto } from './dto/create-opd-test.dto';
import { UpdateOpdTestDto } from './dto/update-opd-test.dto';
import { AddOpdTestVersionDto } from './dto/add-opd-test-version.dto';
import { CloneOpdTestsDto } from './dto/clone-opd-tests.dto';
import { BulkEditOpdTestsDto } from './dto/bulk-edit-opd-tests.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListOpdTestsDto } from './dto/list-opd-tests.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Opd-test endpoints, nested under a master data
 * (`/opd-master-data/:masterDataId/opd-tests`). Business-authenticated;
 * tenant comes from the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('opd-master-data/:masterDataId/opd-tests')
export class OpdTestController {
  constructor(private readonly opdTestService: OpdTestService) {}

  /**
   * Create a opd test (with nested samples + result parameters) in a master data.
   */
  @Post()
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Created a opd test',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateOpdTestDto,
  ) {
    return this.opdTestService.create(masterDataId, tenantId, personId, dto);
  }

  /**
   * List the master data's opd tests (paginated, full scalar rows).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListOpdTestsDto,
  ) {
    return this.opdTestService.findAll(masterDataId, tenantId, query);
  }

  /**
   * Listing screen for a master data's opd tests: search, classification +
   * status filters, and a `view` selecting the projected columns. Declared before
   * the `:testId` routes so `listing` isn't matched as an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListOpdTestsDto,
  ) {
    return this.opdTestService.listForView(masterDataId, tenantId, query);
  }

  /**
   * Deep-clone all opd tests from this master data into a target master data.
   */
  @Post('clone')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Cloned opd tests into another master data',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CloneOpdTestsDto,
  ) {
    return this.opdTestService.cloneAll(
      masterDataId,
      dto.targetMasterDataId,
      tenantId,
    );
  }

  /**
   * Bulk-edit opd tests. Declared before the `:testId` routes.
   */
  @Patch('bulk')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited opd tests',
  })
  bulkEdit(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: BulkEditOpdTestsDto,
  ) {
    return this.opdTestService.bulkEdit(masterDataId, tenantId, dto);
  }

  /**
   * Fetch one opd test composed with its children.
   */
  @Get(':testId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
  ) {
    return this.opdTestService.findById(masterDataId, testId, tenantId);
  }

  /**
   * Update a opd test (and replace child sets when provided).
   */
  @Patch(':testId')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a opd test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
    @Body() dto: UpdateOpdTestDto,
  ) {
    return this.opdTestService.update(masterDataId, testId, tenantId, dto);
  }

  /**
   * Soft-delete a opd test (cascade soft-deletes its children).
   */
  @Delete(':testId')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Deleted a opd test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
  ) {
    return this.opdTestService.remove(masterDataId, testId, tenantId);
  }

  /**
   * Append a version entry to the opd test's version history.
   */
  @Post(':testId/versions')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Added a opd test version',
  })
  addVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
    @Body() dto: AddOpdTestVersionDto,
  ) {
    return this.opdTestService.addVersion(
      masterDataId,
      testId,
      tenantId,
      personId,
      dto,
    );
  }
}
