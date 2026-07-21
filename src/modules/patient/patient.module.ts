import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatientController } from './patient.controller';
import { MedicalHistoryController } from './medical-history.controller';
import { FamilyMemberController } from './family-member.controller';
import { PatientService } from './patient.service';

/**
 * Patient feature module. Exposes patient CRUD plus nested medical-history and
 * family-member endpoints. Exports `PatientService` so other modules (e.g.
 * orders) can resolve a patient within a tenant.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    PatientController,
    MedicalHistoryController,
    FamilyMemberController,
  ],
  providers: [PatientService],
  exports: [PatientService],
})
export class PatientModule {}
