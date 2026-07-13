import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatientController } from './patient.controller';
import { MedicalHistoryController } from './medical-history.controller';
import { PatientService } from './patient.service';

/**
 * Patient feature module. Exposes patient CRUD plus nested medical-history
 * endpoints. Exports `PatientService` so other modules (e.g. orders) can resolve
 * a patient within a tenant.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PatientController, MedicalHistoryController],
  providers: [PatientService],
  exports: [PatientService],
})
export class PatientModule {}
