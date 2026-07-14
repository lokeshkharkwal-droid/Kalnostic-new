import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * Order Management feature module. Tenant-scoped + branch-level. All foreign
 * references (patient / department / doctor / branch-catalogue / referral /
 * person) are validated against Prisma directly. The radiologist, phlebotomist,
 * and radiology technician are now staff `Person`s (validated as active persons).
 */
@Module({
  imports: [PrismaModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
