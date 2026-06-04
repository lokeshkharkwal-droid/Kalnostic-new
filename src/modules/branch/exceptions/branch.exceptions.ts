import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch not found within the tenant. */
export class BranchNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('BRANCH_NOT_FOUND', 'Branch not found', { id }, HttpStatus.NOT_FOUND);
  }
}
