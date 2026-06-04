import { PartialType } from '@nestjs/mapped-types';
import { CreateBranchDto } from './create-branch.dto';

/** All fields optional; validation rules preserved from CreateBranchDto. */
export class UpdateBranchDto extends PartialType(CreateBranchDto) {}
