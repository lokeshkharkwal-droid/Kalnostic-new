import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdapterLogsController } from './adapter-logs.controller';
import { SiteAdminAdapterLogsController } from './siteadmin-adapter-logs.controller';
import { AdapterLogsService } from './adapter-logs.service';

/**
 * Adapter-logs feature module. Exposes a tenant-scoped business read API
 * (`/adapter-logs`) and a SiteAdmin cross-tenant read API
 * (`/siteadmin/adapter-logs`) over the `adapter_logs` table.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdapterLogsController, SiteAdminAdapterLogsController],
  providers: [AdapterLogsService],
  exports: [AdapterLogsService],
})
export class AdapterLogsModule {}
