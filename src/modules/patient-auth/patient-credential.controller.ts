import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PatientCredentialService } from './patient-credential.service';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Staff-facing management of patient-portal login credentials. Business-
 * authenticated (the global `JwtAuthGuard` applies — this is a staff action);
 * tenant + actor come from the JWT, never the body. Enables a patient to log in
 * by issuing the fixed temp password (bcrypt-hashed, forced reset on first use).
 */
@Controller('patients')
export class PatientCredentialController {
  constructor(
    private readonly patientCredentialService: PatientCredentialService,
  ) {}

  /**
   * Enable patient-portal login for a patient: link the platform identity, create
   * credentials with the temp password, and enrol the patient's business. If the
   * person already has credentials (e.g. a staff+patient hybrid) they are kept.
   */
  @Post(':id/login-credentials')
  @HttpCode(HttpStatus.CREATED)
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.UPDATE,
    description: 'Enabled patient-portal login',
  })
  issue(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
  ) {
    return this.patientCredentialService.ensureLoginCredentials(
      tenantId,
      id,
      actorId,
      { reset: false },
    );
  }

  /**
   * Reset a patient's portal password back to the temp password (forces a change
   * on next login). Overwrites an existing password — use for a staff-driven
   * reset.
   */
  @Post(':id/login-credentials/reset')
  @HttpCode(HttpStatus.OK)
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.UPDATE,
    description: 'Reset patient-portal password',
  })
  reset(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
  ) {
    return this.patientCredentialService.ensureLoginCredentials(
      tenantId,
      id,
      actorId,
      { reset: true },
    );
  }
}
