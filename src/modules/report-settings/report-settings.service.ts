import { Injectable } from '@nestjs/common';
import { ReportSetting } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveReportSettingsDto } from './dto/save-report-settings.dto';

/**
 * Tenant-level report settings for Registration — report header/branding,
 * signatures, and delivery/publishing policy. The row is created on first
 * access so the frontend always receives a complete settings object.
 */
@Injectable()
export class ReportSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the current tenant's settings, creating defaults if missing. */
  async getSettings(tenantId: string): Promise<ReportSetting> {
    return this.prisma.reportSetting.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  /** Save a partial/full settings payload with upsert semantics. */
  async saveSettings(
    tenantId: string,
    dto: SaveReportSettingsDto,
  ): Promise<ReportSetting> {
    return this.prisma.reportSetting.upsert({
      where: { tenantId },
      create: { tenantId, ...dto },
      update: { ...dto },
    });
  }
}
