import { Controller, Get, UseGuards } from '@nestjs/common';
import { PatientPortalService } from './patient-portal.service';
import { PatientScopeService } from './patient-scope.service';
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
  constructor(
    private readonly patientPortalService: PatientPortalService,
    private readonly patientScopeService: PatientScopeService,
  ) {}

  /**
   * Home summary: identity, stat tiles, next appointment, ready reports and
   * recent messages — consolidated across EVERY business the person is enrolled in
   * (and every branch within each), scoped to the session's person.
   */
  @Get('home')
  home(@CurrentPatient('person_id') personId: string) {
    return this.patientPortalService.getHome(personId);
  }

  /** The businesses (labs) this patient belongs to (for the Business filter). */
  @Get('businesses')
  businesses(@CurrentPatient('person_id') personId: string) {
    return this.patientPortalService.getBusinesses(personId);
  }

  /**
   * The patients this session may view in the active lab: the person's own
   * record plus linked family members (feeds the "Viewing" dropdown).
   */
  @Get('patients')
  patients(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
  ) {
    return this.patientScopeService.getViewablePatients(tenantId, personId);
  }
}
