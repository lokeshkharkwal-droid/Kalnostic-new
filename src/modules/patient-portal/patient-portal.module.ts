import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';

/**
 * Patient-portal data module (home summary + business list). Imports
 * `PatientAuthModule` so the `'jwt-patient'` strategy backing `PatientJwtGuard`
 * is registered when these routes authenticate.
 */
@Module({
  imports: [PrismaModule, PatientAuthModule],
  controllers: [PatientPortalController],
  providers: [PatientPortalService],
  exports: [PatientPortalService],
})
export class PatientPortalModule {}
