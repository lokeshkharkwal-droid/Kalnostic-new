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
import { RadiologyCertificateService } from './radiology-certificate.service';
import { CreateRadiologyCertificateDto } from './dto/create-radiology-certificate.dto';
import { UpdateRadiologyCertificateDto } from './dto/update-radiology-certificate.dto';
import { ListRadiologyCertificatesDto } from './dto/list-radiology-certificates.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology-certificate endpoints, nested under a master data
 * (`/master-data/:masterDataId/radiology-certificates`). Business-authenticated;
 * tenant comes from the JWT. Managed by business-admin (Tenant MD) and branch-admin
 * (Branch MD) — there is deliberately NO SiteAdmin import. Reuses the master-data
 * permission keys and the `AuditModule.LAB_TEST` audit enum (radiology has none of
 * its own).
 */
@Controller('master-data/:masterDataId/radiology-certificates')
@UseGuards(PermissionGuard)
export class RadiologyCertificateController {
  constructor(private readonly service: RadiologyCertificateService) {}

  /** Create a radiology certificate in a master data. */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BA_MD_ADD_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Created a radiology certificate',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateRadiologyCertificateDto,
  ) {
    return this.service.create(masterDataId, tenantId, personId, dto);
  }

  /** List the master data's radiology certificates (paginated; search/group/status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListRadiologyCertificatesDto,
  ) {
    return this.service.findAll(masterDataId, tenantId, query);
  }

  /** Fetch one radiology certificate. */
  @Get(':certificateId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('certificateId') certificateId: string,
  ) {
    return this.service.findById(masterDataId, certificateId, tenantId);
  }

  /** Update a radiology certificate's scalar fields. */
  @Patch(':certificateId')
  @RequirePermission(PERMISSION_KEYS.BA_MD_UPDATE_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology certificate',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('certificateId') certificateId: string,
    @Body() dto: UpdateRadiologyCertificateDto,
  ) {
    return this.service.update(
      masterDataId,
      certificateId,
      tenantId,
      personId,
      dto,
    );
  }

  /** Soft-delete a radiology certificate. */
  @Delete(':certificateId')
  @RequirePermission(PERMISSION_KEYS.BA_MD_DELETE_TEST)
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology certificate',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('certificateId') certificateId: string,
  ) {
    return this.service.remove(masterDataId, certificateId, tenantId, personId);
  }
}
