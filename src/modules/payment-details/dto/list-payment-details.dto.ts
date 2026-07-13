import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the payment listing endpoint. Extends the shared
 * pagination DTO. `orderId` filters payments to one order.
 */
export class ListPaymentDetailsDto extends PaginationQueryDto {
  /** Filter to payments of a single order. */
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
