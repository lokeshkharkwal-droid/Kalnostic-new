import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { RadiologyTestService } from './radiology-test.service';
import { CreateRadiologyTestDto } from './dto/create-radiology-test.dto';
import { UpdateRadiologyTestDto } from './dto/update-radiology-test.dto';
import { CloneRadiologyTestsDto } from './dto/clone-radiology-tests.dto';
import { ListRadiologyTestsDto } from './dto/list-radiology-tests.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology-test endpoints, nested under a master data
 * (`/master-data/:masterDataId/radiology-tests`). Business-authenticated; tenant
 * comes from the JWT. The global `JwtAuthGuard` protects all routes. Reuses the
 * master-data test permission keys (there are no radiology-specific ones) and the
 * `AuditModule.LAB_TEST` audit enum (radiology has no own enum value).
 */
@Controller('master-data/:masterDataId/radiology-tests')
@UseGuards(PermissionGuard)
export class RadiologyTestController {
  constructor(private readonly radiologyTestService: RadiologyTestService) {}

  /** Create a radiology test (flat) in a master data. */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BA_MD_ADD_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
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
   * List the master data's radiology tests (paginated, full rows). Supports the
   * same server-side search + modality/classification/status filters as
   * `/listing`.
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
   * Listing screen for a master data's radiology tests: search, modality +
   * classification + status filters, and a `view` selecting the projected
   * columns. Declared before the `:radiologyTestId` routes so `listing` isn't
   * matched as an id.
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
   * Clone all radiology tests from this master data into a target master data
   * (duplicate name/code skipped). Returns `{ copied, skipped }`. Declared before
   * the `:radiologyTestId` routes so `clone` isn't matched as an id.
   */
  @Post('clone')
  @RequirePermission(PERMISSION_KEYS.BA_MD_DUPLICATE_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
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

  /** Fetch one radiology test. */
  @Get(':radiologyTestId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('radiologyTestId') radiologyTestId: string,
  ) {
    return this.radiologyTestService.findById(
      masterDataId,
      radiologyTestId,
      tenantId,
    );
  }

  /** Update a radiology test's scalar fields. */
  @Patch(':radiologyTestId')
  @RequirePermission(PERMISSION_KEYS.BA_MD_UPDATE_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('radiologyTestId') radiologyTestId: string,
    @Body() dto: UpdateRadiologyTestDto,
  ) {
    return this.radiologyTestService.update(
      masterDataId,
      radiologyTestId,
      tenantId,
      dto,
    );
  }

  /** Soft-delete a radiology test. */
  @Delete(':radiologyTestId')
  @RequirePermission(PERMISSION_KEYS.BA_MD_DELETE_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('radiologyTestId') radiologyTestId: string,
  ) {
    return this.radiologyTestService.remove(
      masterDataId,
      radiologyTestId,
      tenantId,
    );
  }
}
