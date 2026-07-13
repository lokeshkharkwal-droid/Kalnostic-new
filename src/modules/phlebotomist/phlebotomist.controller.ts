import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PhlebotomistService } from './phlebotomist.service';
import { CreatePhlebotomistDto } from './dto/create-phlebotomist.dto';
import { UpdatePhlebotomistDto } from './dto/update-phlebotomist.dto';
import { ListPhlebotomistsDto } from './dto/list-phlebotomists.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Phlebotomist master-table endpoints. Business-authenticated; tenant from the
 * JWT, branch from the active profile. The global `JwtAuthGuard` protects all routes.
 */
@Controller('phlebotomists')
export class PhlebotomistController {
  constructor(private readonly phlebotomistService: PhlebotomistService) {}

  /** Create a phlebotomist. */
  @Post()
  @Audit({
    module: AuditModule.PHLEBOTOMIST,
    action: AuditAction.CREATE,
    description: 'Created a phlebotomist',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: CreatePhlebotomistDto,
  ) {
    return this.phlebotomistService.create(tenantId, profile.branchId, dto);
  }

  /** List phlebotomists (paginated, with search). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPhlebotomistsDto,
  ) {
    return this.phlebotomistService.findAll(tenantId, query);
  }

  /** Fetch one phlebotomist. */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.phlebotomistService.findById(id, tenantId);
  }

  /** Update a phlebotomist. */
  @Patch(':id')
  @Audit({
    module: AuditModule.PHLEBOTOMIST,
    action: AuditAction.UPDATE,
    description: 'Updated a phlebotomist',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePhlebotomistDto,
  ) {
    return this.phlebotomistService.update(id, tenantId, dto);
  }

  /** Soft-delete a phlebotomist. */
  @Delete(':id')
  @Audit({
    module: AuditModule.PHLEBOTOMIST,
    action: AuditAction.DELETE,
    description: 'Deleted a phlebotomist',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.phlebotomistService.remove(id, tenantId);
  }
}
