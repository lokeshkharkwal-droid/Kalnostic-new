import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuditAction, AuditModule } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto, AssignBranchesDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateBranchAssignmentDto } from './dto/update-branch-assignment.dto';
import { UpdateBranchPermissionsDto } from './dto/update-branch-permissions.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { InvalidProfilePhotoException } from './exceptions/users.exceptions';
import {
  PROFILE_LABELS,
  STAFF_ROLE_KEYS,
} from '../permissions/constants/profile-registry.constant';
import { SYSTEM_MODULES } from '../permissions/constants/system-modules.constant';
import { PERMISSION_CATALOG_BY_MODULE } from '../permissions/constants/module-permissions.constant';
import { ALLOWED_PHOTO_MIME_TYPES } from '../../common/constants/validation-patterns.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/** 2 MB — the v2.0 profile-photo size cap. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/**
 * User Management v2.0 endpoints (business-authenticated; tenant + actor from
 * the JWT). Mounted under `users/manage` so it never collides with the legacy
 * person/patient routes on `users`. Responses use the global `meta` envelope.
 */
@Controller('users/manage')
export class UserManagementController {
  constructor(private readonly usersService: UsersService) {}

  /** Create a staff user (returns the generated user code + login identifier). */
  @Post()
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.CREATE,
    description: 'Created a staff user',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createUser(tenantId, dto, actorId);
  }

  /** List staff users (paginated, filterable, sortable). */
  @Get()
  list(@CurrentTenant() tenantId: string, @Query() query: ListUsersQueryDto) {
    return this.usersService.listUsers(tenantId, query);
  }

  /** Permissions screen: one row per (globally-Active user + branch). */
  @Get('permissions')
  listProfilePermissions(@CurrentTenant() tenantId: string) {
    return this.usersService.listProfilePermissions(tenantId);
  }

  /** The predefined role catalogue (for dropdowns). */
  @Get('roles')
  roles() {
    return STAFF_ROLE_KEYS.map((key) => ({
      key,
      label: PROFILE_LABELS[key],
    }));
  }

  /** The 12 master system modules (for dropdowns/filters). */
  @Get('modules')
  modules() {
    return SYSTEM_MODULES;
  }

  /**
   * The full system permission catalogue (all modules + actions), grouped by
   * module. Static system data the admin permission editor renders before
   * overlaying a user's current grants.
   */
  @Get('permission-catalog')
  permissionCatalog() {
    return PERMISSION_CATALOG_BY_MODULE;
  }

  /**
   * The current user's effective permissions for their active branch, grouped by
   * module (+ a flat `allowed` key list). Context comes from the JWT — used by the
   * frontend to show/hide features.
   */
  @Get('me/permissions')
  myPermissions(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.usersService.getMyPermissions(
      tenantId,
      personId,
      profile.branchId,
      profile.profileKey,
    );
  }

  /** Full detail for one staff user (Aadhaar masked). */
  @Get(':id')
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.usersService.getUser(tenantId, id);
  }

  /** Edit a staff user (identity, password, role, status). */
  @Patch(':id')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated a staff user',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(id, tenantId, dto, actorId);
  }

  /** Upload/replace the user's profile photo (JPG/JPEG/PNG, ≤ 2 MB). */
  @Post(':id/photo')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated a staff user profile photo',
  })
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PHOTO_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          (ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          cb(null, true);
        } else {
          cb(
            new InvalidProfilePhotoException(
              'Only JPG, JPEG and PNG images are allowed',
            ),
            false,
          );
        }
      },
    }),
  )
  uploadPhoto(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new InvalidProfilePhotoException('No photo file was uploaded');
    }
    return this.usersService.uploadProfilePhoto(id, tenantId, file, actorId);
  }

  /** Assign (or update) the user's branch assignments in bulk. */
  @Post(':id/branches')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Assigned branches to a staff user',
  })
  assignBranches(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: AssignBranchesDto,
  ) {
    return this.usersService.assignBranches(
      tenantId,
      id,
      dto.branches,
      actorId,
    );
  }

  /** Patch a single (user + branch) assignment. */
  @Patch(':id/branches/:branchId')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated a staff user branch assignment',
  })
  updateBranchAssignment(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchAssignmentDto,
  ) {
    return this.usersService.updateBranchAssignment(
      tenantId,
      id,
      branchId,
      dto,
      actorId,
    );
  }

  /** Global deactivate (tenant-wide). */
  @Patch(':id/deactivate')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Deactivated a staff user (global)',
  })
  deactivate(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.deactivateUser(tenantId, id, actorId);
  }

  /** Global activate (tenant-wide). */
  @Patch(':id/activate')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Activated a staff user (global)',
  })
  activate(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.activateUser(tenantId, id, actorId);
  }

  /** Resolve module-grouped permissions for a (user + branch). */
  @Get(':id/branch-permissions')
  getBranchPermissions(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('branchId') branchId: string,
  ) {
    return this.usersService.getBranchPermissions(tenantId, id, branchId);
  }

  /** Replace the (user + branch) permission grants. */
  @Put(':id/branch-permissions')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated staff user branch permissions',
  })
  updateBranchPermissions(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchPermissionsDto,
  ) {
    return this.usersService.updateBranchPermissions(
      tenantId,
      id,
      dto,
      actorId,
    );
  }
}
