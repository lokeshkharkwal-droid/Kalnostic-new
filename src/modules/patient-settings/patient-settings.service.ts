import { Injectable } from '@nestjs/common';
import { PatientSetting } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SavePatientSettingsDto } from './dto/save-patient-settings.dto';

/**
 * Tenant-level patient registration settings for Registration. The row is
 * created on first access so the frontend always receives a complete
 * settings object.
 */
@Injectable()
export class PatientSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the current tenant's settings, creating defaults if missing. */
  async getSettings(tenantId: string): Promise<PatientSetting> {
    return this.prisma.patientSetting.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  /** Save a partial/full settings payload with upsert semantics. */
  async saveSettings(
    tenantId: string,
    dto: SavePatientSettingsDto,
  ): Promise<PatientSetting> {
    return this.prisma.patientSetting.upsert({
      where: { tenantId },
      create: { tenantId, ...dto },
      update: { ...dto },
    });
  }
}
