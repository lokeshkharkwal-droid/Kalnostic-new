import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Provides `PrismaService` to any module that imports this one.
 *
 * Feature modules add `PrismaModule` to their `imports` array and then
 * inject `PrismaService` through the constructor (see SKILL.md §1/§3).
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
