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
import { LabTestService } from './lab-test.service';
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { AddLabTestVersionDto } from './dto/add-lab-test-version.dto';
import { CloneLabTestsDto } from './dto/clone-lab-tests.dto';
import { BulkEditLabTestsDto } from './dto/bulk-edit-lab-tests.dto';
import { ImportLabTestsDto } from './dto/import-lab-tests.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ListLabTestsDto } from './dto/list-lab-tests.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Lab-test endpoints, nested under a master data
 * (`/master-data/:masterDataId/lab-tests`). Business-authenticated; tenant comes
 * from the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('master-data/:masterDataId/lab-tests')
export class LabTestController {
  constructor(private readonly labTestService: LabTestService) {}

  /**
   * Create a lab test (with nested samples + result parameters) in a master data.
   */
  @Post()
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Created a lab test',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateLabTestDto,
  ) {
    return this.labTestService.create(masterDataId, tenantId, personId, dto);
  }

  /**
   * List the master data's lab tests (paginated, core rows only).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.labTestService.findAll(
      masterDataId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Listing screen for a master data's lab tests: search (`testName`/`testCode`),
   * classification + status filters, and a `view` selecting the projected columns
   * (and nested children for the child-centric views). Paginated by lab test.
   * Declared before the `:labTestId` routes so `listing` isn't matched as an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListLabTestsDto,
  ) {
    return this.labTestService.listForView(masterDataId, tenantId, query);
  }

  /**
   * Deep-clone all lab tests from this master data into a target master data
   * (duplicate name/code skipped). Returns `{ copied, skipped }`.
   */
  @Post('clone')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Cloned lab tests into another master data',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CloneLabTestsDto,
  ) {
    return this.labTestService.cloneAll(
      masterDataId,
      dto.targetMasterDataId,
      tenantId,
    );
  }

  /**
   * Bulk-edit lab tests: apply per-test scalar changes to the selected ids.
   * Declared before the `:labTestId` routes so `bulk` isn't matched as an id.
   */
  @Patch('bulk')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited lab tests',
  })
  bulkEdit(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: BulkEditLabTestsDto,
  ) {
    return this.labTestService.bulkEdit(masterDataId, tenantId, dto);
  }

  /**
   * Bulk-import lab tests (create-only) from the frontend's parsed Excel rows.
   * Declared before the `:labTestId` routes so `import` isn't matched as an id.
   */
  @Post('import')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Imported lab tests',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: ImportLabTestsDto,
  ) {
    return this.labTestService.importAll(masterDataId, tenantId, personId, dto);
  }

  /**
   * Fetch one lab test composed with its children.
   */
  @Get(':labTestId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('labTestId') labTestId: string,
  ) {
    return this.labTestService.findById(masterDataId, labTestId, tenantId);
  }

  /**
   * Update a lab test (and replace child sets when provided).
   */
  @Patch(':labTestId')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Updated a lab test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('labTestId') labTestId: string,
    @Body() dto: UpdateLabTestDto,
  ) {
    return this.labTestService.update(masterDataId, labTestId, tenantId, dto);
  }

  /**
   * Soft-delete a lab test (cascade soft-deletes its children).
   */
  @Delete(':labTestId')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.DELETE,
    description: 'Deleted a lab test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('labTestId') labTestId: string,
  ) {
    return this.labTestService.remove(masterDataId, labTestId, tenantId);
  }

  /**
   * Append a version entry to the lab test's version history.
   */
  @Post(':labTestId/versions')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Added a lab test version',
  })
  addVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('labTestId') labTestId: string,
    @Body() dto: AddLabTestVersionDto,
  ) {
    return this.labTestService.addVersion(
      masterDataId,
      labTestId,
      tenantId,
      personId,
      dto,
    );
  }
}
