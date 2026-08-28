import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { EmiController } from './emi.controller';
import { EmiService } from './emi.service';

/**
 * EMI (External Machine Interface) module — the lab-analyzer compatibility layer
 * (`/emi/orders`, `/emi/submitResult`). Machine-authenticated via `LabAdapter`
 * tokens (resolved against the DB in the service), so it needs no other module —
 * all writes (result values, report status, audit rows) go through
 * `PrismaService` inside the adapter's tenant context.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EmiController],
  providers: [EmiService],
})
export class EmiModule {}
