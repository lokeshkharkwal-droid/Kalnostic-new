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
import { RadiologyTestService } from './radiology-test.service';
import { CreateRadiologyTestDto } from './dto/create-radiology-test.dto';
import { UpdateRadiologyTestDto } from './dto/update-radiology-test.dto';
import { AddRadiologyTestVersionDto } from './dto/add-radiology-test-version.dto';
import { CloneRadiologyTestsDto } from './dto/clone-radiology-tests.dto';
import { BulkEditRadiologyTestsDto } from './dto/bulk-edit-radiology-tests.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListRadiologyTestsDto } from './dto/list-radiology-tests.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology-test endpoints, nested under a master data
 * (`/radiology-master-data/:masterDataId/radiology-tests`). Business-authenticated;
 * tenant comes from the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('radiology-master-data/:masterDataId/radiology-tests')
export class RadiologyTestController {
  constructor(private readonly radiologyTestService: RadiologyTestService) {}

  /**
   * Create a radiology test (with nested samples + result parameters) in a master data.
   */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Created a radiology test',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateRadiologyTestDto,
  ) {
    return this.radiologyTestService.create(
      masterDataId,
      tenantId,
      personId,
      dto,
    );
  }

  /**
   * List the master data's radiology tests (paginated, full scalar rows).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListRadiologyTestsDto,
  ) {
    return this.radiologyTestService.findAll(masterDataId, tenantId, query);
  }

  /**
   * Listing screen for a master data's radiology tests: search, classification +
   * status filters, and a `view` selecting the projected columns. Declared before
   * the `:testId` routes so `listing` isn't matched as an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListRadiologyTestsDto,
  ) {
    return this.radiologyTestService.listForView(masterDataId, tenantId, query);
  }

  /**
   * Deep-clone all radiology tests from this master data into a target master data.
   */
  @Post('clone')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Cloned radiology tests into another master data',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CloneRadiologyTestsDto,
  ) {
    return this.radiologyTestService.cloneAll(
      masterDataId,
      dto.targetMasterDataId,
      tenantId,
    );
  }

  /**
   * Bulk-edit radiology tests. Declared before the `:testId` routes.
   */
  @Patch('bulk')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited radiology tests',
  })
  bulkEdit(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: BulkEditRadiologyTestsDto,
  ) {
    return this.radiologyTestService.bulkEdit(masterDataId, tenantId, dto);
  }

  /**
   * Fetch one radiology test composed with its children.
   */
  @Get(':testId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
  ) {
    return this.radiologyTestService.findById(masterDataId, testId, tenantId);
  }

  /**
   * Update a radiology test (and replace child sets when provided).
   */
  @Patch(':testId')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
    @Body() dto: UpdateRadiologyTestDto,
  ) {
    return this.radiologyTestService.update(
      masterDataId,
      testId,
      tenantId,
      dto,
    );
  }

  /**
   * Soft-delete a radiology test (cascade soft-deletes its children).
   */
  @Delete(':testId')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
  ) {
    return this.radiologyTestService.remove(masterDataId, testId, tenantId);
  }

  /**
   * Append a version entry to the radiology test's version history.
   */
  @Post(':testId/versions')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Added a radiology test version',
  })
  addVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('testId') testId: string,
    @Body() dto: AddRadiologyTestVersionDto,
  ) {
    return this.radiologyTestService.addVersion(
      masterDataId,
      testId,
      tenantId,
      personId,
      dto,
    );
  }
}
