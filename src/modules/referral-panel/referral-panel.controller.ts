import {
  UseGuards,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { InvalidUploadFileException } from '../uploads/exceptions/uploads.exceptions';
import { ReferralPanelService } from './referral-panel.service';
import { ReferralPanelUserService } from './referral-panel-user.service';
import { CreateReferralPanelDto } from './dto/create-referral-panel.dto';
import { CreateReferralPanelUserDto } from './dto/create-referral-panel-user.dto';
import { UpdateReferralPanelUserDto } from './dto/update-referral-panel-user.dto';
import { UpdateReferralPanelDto } from './dto/update-referral-panel.dto';
import { ListReferralPanelsDto } from './dto/list-referral-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_XLSX_BYTES = 10 * 1024 * 1024; // 10 MB, matches the generic attachment upload cap

/**
 * Referral-panel endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-panels')
@UseGuards(PermissionGuard)
export class ReferralPanelController {
  constructor(
    private readonly referralPanelService: ReferralPanelService,
    private readonly referralPanelUserService: ReferralPanelUserService,
  ) {}

  /**
   * Create a referral panel with its assigned lab tests/panels.
   */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BR_REF_ADD_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a referral panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateReferralPanelDto,
  ) {
    return this.referralPanelService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * Bulk-import referral panels from an uploaded `.xlsx` workbook (one row = one
   * panel; every template column is mapped). CREATE-ONLY, SKIP-AND-REPORT: valid
   * rows are created via the same logic as `POST /referral-panels`; invalid or
   * conflicting rows are skipped and returned in the response's `skipped[]` (with
   * row number + reason). Only a file-level structural failure rejects the whole
   * upload. Declared before the `:id` routes so `import-xlsx` isn't matched as an
   * id.
   */
  @Post('import-xlsx')
  @RequirePermission(PERMISSION_KEYS.BR_REF_ADD_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.CREATE,
    description: 'Imported referral panels from an Excel workbook',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_XLSX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype === XLSX_MIME_TYPE) {
          cb(null, true);
        } else {
          cb(new InvalidUploadFileException('Unsupported file type'), false);
        }
      },
    }),
  )
  importXlsx(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new InvalidUploadFileException('No file was uploaded');
    }
    return this.referralPanelService.importXlsx(
      tenantId,
      personId,
      file.buffer,
    );
  }

  /**
   * List referral panels in the caller's tenant (paginated; optional `search`,
   * `clientType`, `status`, and `branchId`).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListReferralPanelsDto,
  ) {
    return this.referralPanelService.findAll(tenantId, profile.branchId, query);
  }

  /**
   * Fetch one referral panel by id (with assigned lab tests/panels).
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.referralPanelService.findById(id, tenantId, profile.branchId);
  }

  /**
   * Update a referral panel (assigned lab tests/panels are replace-all when sent).
   */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_UPDATE_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a referral panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferralPanelDto,
  ) {
    return this.referralPanelService.update(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * Soft-delete a referral panel (cascades to assigned lab tests/panels).
   */
  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_DELETE_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.DELETE,
    description: 'Deleted a referral panel',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralPanelService.remove(id, tenantId);
  }

  /**
   * Fetch the referral panel's dedicated B2B login user, if one exists (drives
   * the create/edit state of the "Create Referral Panel User" button).
   * @param id the referral panel id
   * @param tenantId the caller's tenant (from JWT)
   */
  @Get(':id/user')
  getPanelUser(@Param('id') id: string, @CurrentTenant() tenantId: string) {
    return this.referralPanelUserService.getForPanel(tenantId, id);
  }

  /**
   * Create the referral panel's dedicated B2B login user (1:1). Branch, role,
   * modules and status are server-assigned; only personal/login fields are taken
   * from the body.
   * @param id the referral panel id
   * @param dto personal + login fields
   * @param tenantId the caller's tenant (from JWT)
   * @param actorId the acting user (from JWT) — used as createdBy
   */
  @Post(':id/user')
  @RequirePermission(PERMISSION_KEYS.BR_REF_ADD_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a referral panel login user',
  })
  createPanelUser(
    @Param('id') id: string,
    @Body() dto: CreateReferralPanelUserDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
  ) {
    return this.referralPanelUserService.create(tenantId, id, dto, actorId);
  }

  /**
   * Update the referral panel's B2B login user (the eight editable personal/login
   * fields only). Branch, role, modules and status stay server-controlled.
   * @param id the referral panel id
   * @param dto the changed fields
   * @param tenantId the caller's tenant (from JWT)
   */
  @RequirePermission(PERMISSION_KEYS.BR_REF_UPDATE_PANEL)
  @Patch(':id/user')
  updatePanelUser(
    @Param('id') id: string,
    @Body() dto: UpdateReferralPanelUserDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.referralPanelUserService.update(tenantId, id, dto);
  }
}
