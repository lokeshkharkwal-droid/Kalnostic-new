import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CategoryModule } from '../category/category.module';
import { DepartmentModule } from '../department/department.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';

/**
 * Document feature module. Tenant-scoped, branch-level — manages controlled
 * documents (SOPs, policies, certificates, …) with immutable version history.
 * Imports CategoryModule and DepartmentModule to validate a document's optional
 * category/department via their exported services (CLAUDE.md rule #3 — never
 * import another service directly).
 */
@Module({
  imports: [PrismaModule, CategoryModule, DepartmentModule],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
