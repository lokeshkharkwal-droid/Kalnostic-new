import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PatientService } from './patient.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Family-member endpoints nested under a patient
 * (`/patients/:patientId/family-members`). Business-authenticated; tenant comes
 * from the JWT and the registration branch from the active profile. Each family
 * member is created as an independent `Patient` linked to the anchor patient
 * (directional link). The global `JwtAuthGuard` protects all routes.
 */
@Controller('patients/:patientId/family-members')
export class FamilyMemberController {
  constructor(private readonly patientService: PatientService) {}

  /**
   * Add a family member to the anchor patient: creates a new independent patient
   * (name/age/mobile/relationship/umId only) and links it to the anchor.
   */
  @Post()
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.CREATE,
    description: 'Added a patient family member',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('patientId') patientId: string,
    @Body() dto: CreateFamilyMemberDto,
  ) {
    return this.patientService.addFamilyMember(tenantId, patientId, dto, {
      branchId: profile.branchId,
      actorId: personId,
    });
  }

  /** List the anchor patient's active family members (most recent first). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
  ) {
    return this.patientService.findFamilyMembers(tenantId, patientId);
  }

  /** Unlink a family member (soft-delete the mapping row only). */
  @Delete(':linkId')
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.DELETE,
    description: 'Removed a patient family member link',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
    @Param('linkId') linkId: string,
  ) {
    return this.patientService.removeFamilyMember(tenantId, patientId, linkId);
  }
}
