import { Controller, Get, UseGuards } from '@nestjs/common';
import { PatientPortalService } from './patient-portal.service';
import { PatientJwtGuard } from '../patient-auth/guards/patient-jwt.guard';
import { CurrentPatient } from '../patient-auth/decorators/current-patient.decorator';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Patient-portal data (read-only), for the authenticated patient's active
 * tenant. `@Public()` opts the whole controller out of the global business
 * `JwtAuthGuard`; `PatientJwtGuard` authenticates via the `'jwt-patient'`
 * strategy and populates `req.user`, so the tenant RLS context + scoping apply.
 */
@Public()
@UseGuards(PatientJwtGuard)
@Controller('patient-portal')
export class PatientPortalController {
  constructor(private readonly patientPortalService: PatientPortalService) {}

  /**
   * Home summary: identity, stat tiles, next appointment, ready reports and
   * recent messages — consolidated across EVERY branch of the session's tenant
   * (no branch filter), scoped to the session's person + tenant.
   */
  @Get('home')
  home(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @CurrentPatient('patient_id') patientId: string,
  ) {
    return this.patientPortalService.getHome(tenantId, personId, patientId);
  }

  /** The businesses (labs) this patient can switch into (for the lab switcher). */
  @Get('businesses')
  businesses(@CurrentPatient('person_id') personId: string) {
    return this.patientPortalService.getBusinesses(personId);
  }
}
