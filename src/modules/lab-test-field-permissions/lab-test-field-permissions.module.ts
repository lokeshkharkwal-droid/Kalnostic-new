import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LabTestFieldPermissionsController } from './lab-test-field-permissions.controller';
import { LabTestFieldPermissionsService } from './lab-test-field-permissions.service';

@Module({
  imports: [PrismaModule],
  controllers: [LabTestFieldPermissionsController],
  providers: [LabTestFieldPermissionsService],
  exports: [LabTestFieldPermissionsService],
})
export class LabTestFieldPermissionsModule {}
