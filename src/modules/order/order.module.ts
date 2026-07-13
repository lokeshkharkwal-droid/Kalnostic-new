import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RadiologistModule } from '../radiologist/radiologist.module';
import { PhlebotomistModule } from '../phlebotomist/phlebotomist.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * Order Management feature module. Tenant-scoped + branch-level. Imports the
 * radiologist/phlebotomist master-table modules to validate radiology/diagnostics
 * references via their services (rule #3 — DI, not direct file imports). Patient /
 * department / doctor / branch-catalogue / referral / person references are
 * validated against Prisma directly. The radiology technician is now a `Person`.
 */
@Module({
  imports: [PrismaModule, RadiologistModule, PhlebotomistModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
