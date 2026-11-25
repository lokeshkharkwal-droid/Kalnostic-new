import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LabReportModule } from '../lab-report/lab-report.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { PatientLabOrdersController } from './patient-lab-orders.controller';
import { PatientLabOrdersService } from './patient-lab-orders.service';
import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';
import { PatientScopeService } from './patient-scope.service';

/**
 * Patient-portal data module: home summary, business list, the viewable-patient
 * (family) list and the read-only lab orders. Imports `PatientAuthModule` so the
 * `'jwt-patient'` strategy backing `PatientJwtGuard` is registered when these
 * routes authenticate; `LabReportModule` supplies the report PDF rendering and
 * `TenantModule` the business's display locale.
 */
@Module({
  imports: [PrismaModule, PatientAuthModule, LabReportModule, TenantModule],
  controllers: [PatientPortalController, PatientLabOrdersController],
  providers: [
    PatientPortalService,
    PatientScopeService,
    PatientLabOrdersService,
  ],
  exports: [PatientPortalService, PatientScopeService],
})
export class PatientPortalModule {}
