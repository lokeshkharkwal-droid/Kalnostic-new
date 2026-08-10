import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PtCategoryModule } from '../pt-category/pt-category.module';
import { PatientController } from './patient.controller';
import { MedicalHistoryController } from './medical-history.controller';
import { FamilyMemberController } from './family-member.controller';
import { PatientDocumentController } from './patient-document.controller';
import { PatientService } from './patient.service';

/**
 * Patient feature module. Exposes patient CRUD plus nested medical-history and
 * family-member endpoints. Imports `PtCategoryModule` so the service can validate
 * a patient's PT Category against the active branch (rule #3). Exports
 * `PatientService` so other modules (e.g. orders) can resolve a patient within a
 * tenant.
 */
@Module({
  imports: [PrismaModule, PtCategoryModule],
  controllers: [
    PatientController,
    MedicalHistoryController,
    FamilyMemberController,
    PatientDocumentController,
  ],
  providers: [PatientService],
  exports: [PatientService],
})
export class PatientModule {}
