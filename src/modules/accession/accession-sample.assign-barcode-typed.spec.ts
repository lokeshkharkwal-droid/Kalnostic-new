import { EventEmitter2 } from '@nestjs/event-emitter';
import { SampleStatus } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import {
  BarcodeReservedByRepeatException,
  refusalMessage,
} from './exceptions/accession.exceptions';

/**
 * A barcode typed by hand (Edit / Assign Barcode) must be free across the tenant:
 *  - whatever the capitals ("Cv1" and "cv1" are the same barcode: the search ignores capitals too);
 *  - two people typing the same new barcode at the same moment take turns (the tenant row is locked first),
 *    so the second one finds the first one's barcode and is refused.
 */
describe('OrderSampleService.assignBarcode - typed barcode', () => {
  const build = (
    clash: { id: string } | null = null,
    reserved: { id: string } | null = null,
  ) => {
    const order: string[] = [];
    const tx = {
      tenant: {
        update: jest.fn().mockImplementation(() => {
          order.push('lock tenant');
          return Promise.resolve({ id: 't1' });
        }),
      },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            status: SampleStatus.COLLECTED,
            branchId: 'b1',
            barcode: null,
            orderId: 'o1',
            sourceTransferId: null,
          },
        ]),
        findFirst: jest
          .fn()
          .mockImplementation((args?: { where?: Record<string, unknown> }) => {
            // The reservation look-up asks for a sample that waits for its new tube (it names `barcodeBeforeRepeat`).
            if (args?.where && 'barcodeBeforeRepeat' in args.where) {
              order.push('check reserved');
              return Promise.resolve(reserved);
            }
            order.push('check clash');
            return Promise.resolve(clash);
          }),
        updateMany: jest.fn().mockImplementation(() => {
          order.push('write');
          return Promise.resolve({ count: 1 });
        }),
      },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const barcodes = {
      generateAndUpload: jest.fn().mockResolvedValue('https://img/x.png'),
      allocateNumberInTx: jest.fn().mockResolvedValue('10001'),
    };
    const service = new OrderSampleService(
      prisma as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      barcodes as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve({ id }) as never);
    return { tx, service, order, barcodes };
  };

  it('looks for a clash ignoring capitals', async () => {
    const { tx, service } = build();
    await service.assignBarcode(['s1'], 't1', 'p1', { barcode: 'cv357390' });
    const args = (
      tx.orderSample.findFirst.mock.calls as unknown as [
        { where: Record<string, unknown> },
      ][]
    )[0]![0];
    expect(args.where.barcode).toEqual({
      equals: 'cv357390',
      mode: 'insensitive',
    });
    expect(args.where).toMatchObject({
      tenantId: 't1',
      deletedAt: null,
      id: { notIn: ['s1'] },
    });
  });

  it('refuses a barcode another order already has (here: found by the case-insensitive check)', async () => {
    const { service, tx } = build({ id: 'other' });
    await expect(
      service.assignBarcode(['s1'], 't1', 'p1', { barcode: 'cv357390' }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
  });

  it('locks the tenant row BEFORE the clash check and the write, so simultaneous typed barcodes take turns', async () => {
    const { service, order } = build();
    await service.assignBarcode(['s1'], 't1', 'p1', { barcode: 'NEW-1' });
    expect(order).toEqual([
      'lock tenant',
      'check clash',
      'check reserved',
      'write',
    ]);
  });

  it('does not lock anything for an automatic barcode (the counter row already serialises it)', async () => {
    const { service, tx, barcodes } = build();
    await service.assignBarcode(['s1'], 't1', 'p1', {});
    expect(tx.tenant.update).not.toHaveBeenCalled();
    expect(barcodes.allocateNumberInTx).toHaveBeenCalled();
  });
});

/**
 * A number a Repeat took off a sample that still waits for its new tube stays reserved for it (Retrieve can still put it
 * back); once the sample is collected again the number is free. Typed numbers only - the automatic counter never reuses one.
 */
describe('OrderSampleService.assignBarcode - a number held by a Repeat', () => {
  const make = (reserved: { id: string } | null) => {
    const tx = {
      tenant: { update: jest.fn().mockResolvedValue({ id: 't1' }) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            status: SampleStatus.COLLECTED,
            branchId: 'b1',
            barcode: null,
            orderId: 'o1',
            sourceTransferId: null,
          },
        ]),
        findFirst: jest
          .fn()
          .mockImplementation((args?: { where?: Record<string, unknown> }) =>
            Promise.resolve(
              args?.where && 'barcodeBeforeRepeat' in args.where
                ? reserved
                : null,
            ),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const service = new OrderSampleService(
      prisma as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {
        generateAndUpload: jest.fn().mockResolvedValue('https://img/x.png'),
        allocateNumberInTx: jest.fn().mockResolvedValue('10001'),
      } as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve({ id }) as never);
    return { tx, service };
  };

  const reservationWhere = (tx: ReturnType<typeof make>['tx']) =>
    (
      tx.orderSample.findFirst.mock.calls as unknown as [
        { where: Record<string, unknown> },
      ][]
    ).find((c) => 'barcodeBeforeRepeat' in c[0].where)![0].where;

  it('refuses a typed number a waiting sample still holds, and writes nothing', async () => {
    const { service, tx } = make({ id: 'waiting' });
    await expect(
      service.assignBarcode(['s1'], 't1', 'p1', { barcode: '99573' }),
    ).rejects.toBeInstanceOf(BarcodeReservedByRepeatException);
    expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
  });

  it('only a sample that is WAITING counts: no barcode now, Repeat or Hold, the old number remembered, whatever the capitals', async () => {
    const { service, tx } = make(null);
    await service.assignBarcode(['s1'], 't1', 'p1', { barcode: 'cv-7' });
    expect(reservationWhere(tx)).toEqual({
      tenantId: 't1',
      deletedAt: null,
      barcode: null,
      status: { in: [SampleStatus.REPEAT, SampleStatus.HOLD] },
      barcodeBeforeRepeat: { equals: 'cv-7', mode: 'insensitive' },
    });
  });

  it('a number nobody holds (or one freed because the sample was collected again) can be typed', async () => {
    const { service, tx } = make(null);
    await service.assignBarcode(['s1'], 't1', 'p1', { barcode: '99573' });
    expect(tx.orderSample.updateMany).toHaveBeenCalled();
  });

  it('the refusal says what to do', () => {
    const e = new BarcodeReservedByRepeatException('99573');
    expect(e.errorCode).toBe('BARCODE_RESERVED_BY_REPEAT');
    expect(refusalMessage(e)).toContain('99573');
    expect(e.getStatus()).toBe(422);
  });
});
