import { OrderFieldConfig } from '@prisma/client';

/** The field-visibility map: `{ section: { field: boolean } }`. */
export type OrderFieldConfigMap = Record<string, Record<string, boolean>>;

/**
 * Domain/response shape for a branch's order field configuration. The Prisma
 * model is the DB source of truth; `config` is persisted as JSON and carries
 * the `OrderFieldConfigMap` shape above.
 */
export type OrderFieldConfigEntity = Omit<OrderFieldConfig, 'config'> & {
  config: OrderFieldConfigMap;
};
