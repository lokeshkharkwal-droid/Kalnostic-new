import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { OrderFieldConfigController } from './order-field-config.controller';
import { OrderFieldConfigService } from './order-field-config.service';

/**
 * Create-Order field configuration module (branch-specific). Imports
 * `BranchModule` to validate the owning branch against the tenant (CLAUDE.md
 * rule #3 — services are injected, never imported directly).
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [OrderFieldConfigController],
  providers: [OrderFieldConfigService],
  exports: [OrderFieldConfigService],
})
export class OrderFieldConfigModule {}
