import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MachineStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for the machine listing screen: free-text search (machineName / code /
 * serialNo), plus optional status + department filters, on top of offset
 * pagination.
 */
export class ListMachinesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(MachineStatus)
  status?: MachineStatus;

  @IsOptional()
  @IsString()
  departmentId?: string;
}
