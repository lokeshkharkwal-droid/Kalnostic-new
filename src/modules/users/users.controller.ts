import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import {
  AssignProfileDto,
  RevokeProfileDto,
  SetDefaultProfileDto,
} from './dto/assign-profile.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
import { SetReceptionistDoctorsDto } from './dto/set-receptionist-doctors.dto';
import { AuditAction, AuditModule } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * User/person management (business-authenticated; tenant + actor come from the
 * JWT). The global `JwtAuthGuard` protects all routes.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Register a new patient in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.CREATE,
    description: 'Registered a patient',
  })
  registerPatient(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Body() dto: CreatePersonDto,
  ) {
    return this.usersService.registerPerson(tenantId, dto, actorId, true);
  }

  /**
   * List all staff in the caller's tenant (grouped by person).
   */
  @Get('staff')
  listStaff(@CurrentTenant() tenantId: string) {
    return this.usersService.listTenantStaff(tenantId);
  }

  /**
   * Register a new staff member (returns a one-time temp password).
   */
  @Post('staff')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.CREATE,
    description: 'Registered a staff member',
  })
  registerStaff(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Body() dto: RegisterStaffDto,
  ) {
    return this.usersService.registerStaff(tenantId, dto, actorId);
  }

  /**
   * Fetch a person by id.
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  /**
   * Update a person's basic details (ownership rules apply).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: "Updated a person's details",
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.usersService.updatePersonDetails(id, tenantId, dto, actorId);
  }

  /**
   * Assign a profile to a person at a branch (or tenant-level).
   */
  @Post(':id/profiles')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.CREATE,
    description: 'Assigned a profile to a person',
  })
  assignProfile(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: AssignProfileDto,
  ) {
    return this.usersService.assignProfile(
      tenantId,
      id,
      dto.branchId ?? null,
      dto.profileKey,
      actorId,
      dto.isDefault ?? false,
    );
  }

  /**
   * Revoke a profile assignment (soft).
   */
  @Delete(':id/profiles')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.DELETE,
    description: 'Revoked a profile assignment',
  })
  revokeProfile(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: RevokeProfileDto,
  ) {
    return this.usersService.revokeProfile(
      tenantId,
      id,
      dto.branchId ?? null,
      dto.profileKey,
      actorId,
    );
  }

  /**
   * Set the default landing profile for a person.
   */
  @Patch(':id/default-profile')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Set a default profile',
  })
  setDefaultProfile(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetDefaultProfileDto,
  ) {
    return this.usersService.setDefaultProfile(
      tenantId,
      id,
      dto.profileKey,
      dto.branchId ?? null,
    );
  }

  /**
   * Resolve the effective permissions for a profile assignment.
   */
  @Get(':id/permissions')
  getPermissions(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('profileKey') profileKey: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.usersService.getProfilePermissions(
      tenantId,
      id,
      branchId ?? null,
      profileKey,
    );
  }

  /**
   * Replace the permission overrides for a profile assignment.
   */
  @Put(':id/permissions')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated profile permission overrides',
  })
  setPermissions(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: SetPermissionsDto,
  ) {
    return this.usersService.setProfilePermissions(
      tenantId,
      id,
      dto.branchId ?? null,
      dto.profileKey,
      dto.overrides,
      actorId,
    );
  }

  /**
   * List the doctors mapped to a receptionist at a branch.
   */
  @Get(':id/receptionist-doctors')
  getReceptionistDoctors(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('branchId') branchId: string,
  ) {
    return this.usersService.getReceptionistDoctors(tenantId, id, branchId);
  }

  /**
   * Replace the doctors mapped to a receptionist at a branch.
   */
  @Put(':id/receptionist-doctors')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated receptionist-doctor mappings',
  })
  setReceptionistDoctors(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: SetReceptionistDoctorsDto,
  ) {
    return this.usersService.setReceptionistDoctors(
      tenantId,
      id,
      dto.branchId,
      dto.doctorPersonIds,
      actorId,
    );
  }

  /**
   * Reset a staff member's password (returns a one-time temp password).
   */
  @Post(':id/reset-password')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: "Reset a staff member's password",
  })
  resetPassword(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.resetStaffPassword(id, tenantId, actorId);
  }
}
