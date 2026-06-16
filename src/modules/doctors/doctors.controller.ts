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
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { ListDoctorsDto } from './dto/list-doctors.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Doctor registry endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  /**
   * Register a doctor in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.DOCTOR,
    action: AuditAction.CREATE,
    description: 'Created a doctor',
  })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateDoctorDto) {
    return this.doctorsService.create(tenantId, dto);
  }

  /**
   * List doctors in the caller's tenant (paginated; trimmed fields). Supports
   * `search` (name / reg-no), `departmentId`, and `status` filters.
   */
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ListDoctorsDto) {
    return this.doctorsService.findAllForTenant(tenantId, query);
  }

  /**
   * Fetch one doctor by id (full record incl. qualifications + experiences).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.doctorsService.findById(id, tenantId);
  }

  /**
   * Update a doctor.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.DOCTOR,
    action: AuditAction.UPDATE,
    description: 'Updated a doctor',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDoctorDto,
  ) {
    return this.doctorsService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a doctor.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.DOCTOR,
    action: AuditAction.DELETE,
    description: 'Deleted a doctor',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.doctorsService.remove(id, tenantId);
  }
}
