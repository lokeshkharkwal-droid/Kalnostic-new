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
import { RadiologistService } from './radiologist.service';
import { CreateRadiologistDto } from './dto/create-radiologist.dto';
import { UpdateRadiologistDto } from './dto/update-radiologist.dto';
import { ListRadiologistsDto } from './dto/list-radiologists.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiologist master-table endpoints. Business-authenticated; tenant comes from
 * the JWT and the branch from the active profile. The global `JwtAuthGuard`
 * protects all routes.
 */
@Controller('radiologists')
export class RadiologistController {
  constructor(private readonly radiologistService: RadiologistService) {}

  /** Create a radiologist. */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGIST,
    action: AuditAction.CREATE,
    description: 'Created a radiologist',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: CreateRadiologistDto,
  ) {
    return this.radiologistService.create(tenantId, profile.branchId, dto);
  }

  /** List radiologists (paginated, with search + department filter). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListRadiologistsDto,
  ) {
    return this.radiologistService.findAll(tenantId, query);
  }

  /** Fetch one radiologist. */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.radiologistService.findById(id, tenantId);
  }

  /** Update a radiologist. */
  @Patch(':id')
  @Audit({
    module: AuditModule.RADIOLOGIST,
    action: AuditAction.UPDATE,
    description: 'Updated a radiologist',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRadiologistDto,
  ) {
    return this.radiologistService.update(id, tenantId, dto);
  }

  /** Soft-delete a radiologist. */
  @Delete(':id')
  @Audit({
    module: AuditModule.RADIOLOGIST,
    action: AuditAction.DELETE,
    description: 'Deleted a radiologist',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.radiologistService.remove(id, tenantId);
  }
}
