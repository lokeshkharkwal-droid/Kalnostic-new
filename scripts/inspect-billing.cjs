const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const code = process.argv[2];
const n = (x) => x == null ? 0 : Number(x);
(async () => {
  const where = code ? { orderCode: code } : {};
  const o = await p.order.findFirst({
    where: { ...where, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      items: { where: { deletedAt: null }, select: { unitPrice: true, discount: true, direct: true, branchLabTest: { select: { testName: true } }, branchLabPanel: { select: { panelName: true } } } },
      payments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { entryType: true, totalAmount: true, orderDiscount: true, orderDiscountMode: true, orderDiscountValue: true, netAmount: true, paidAmount: true, refundAmount: true, refundCharge: true } },
      diagnostics: { select: { sampleCollectionCharges: true, visitCharges: true } },
    },
  });
  if (!o) { console.log('No order found for', code || '(latest)'); return p.$disconnect(); }
  console.log('ORDER', o.orderCode, '| billId', o.billId, '| status', o.status, '| paymentStatus', o.paymentStatus, '| refundStatus', o.refundStatus, '| cancelCharge', n(o.cancellationCharge));
  console.log('ITEMS ('+o.items.length+' active):');
  for (const it of o.items) console.log('  -', it.branchLabTest?.testName || it.branchLabPanel?.panelName || it.direct || '?', '| unitPrice', n(it.unitPrice), '| lineDiscount', n(it.discount));
  console.log('PAYMENTS:');
  for (const pr of o.payments) console.log('  -', pr.entryType, '| total', n(pr.totalAmount), '| orderDisc', n(pr.orderDiscount), '| mode', pr.orderDiscountMode, '| value', pr.orderDiscountValue, '| net', n(pr.netAmount), '| paid', n(pr.paidAmount), '| refund', n(pr.refundAmount));
  // Replicate computeBillingTotals
  const items = o.items.map(i => ({ unitPrice: n(i.unitPrice), discount: n(i.discount) }));
  const pays = o.payments.map(pr => ({ totalAmount: n(pr.totalAmount), orderDiscount: n(pr.orderDiscount), netAmount: n(pr.netAmount), orderDiscountMode: pr.orderDiscountMode, orderDiscountValue: pr.orderDiscountValue }));
  const lineDiscount = items.reduce((s,i)=>s+i.discount,0);
  const itemsTotal = items.reduce((s,i)=>s+i.unitPrice,0);
  const storedOrderDiscount = pays.reduce((s,pr)=>s+pr.orderDiscount,0);
  const storedNet = pays.reduce((s,pr)=>s+pr.netAmount,0);
  const snap = pays.find(pr=>pr.orderDiscountMode!=null);
  const recomputed = snap ? Math.min(Math.max(snap.orderDiscountMode==='PERCENT'?(itemsTotal*(snap.orderDiscountValue??0))/100:(snap.orderDiscountValue??0),0),Math.max(itemsTotal,0)) : storedOrderDiscount;
  const net = storedNet + storedOrderDiscount - recomputed;
  const discount = lineDiscount + recomputed;
  const gross = net + discount;
  const paid = pays.length? o.payments.reduce((s,pr)=>s+n(pr.paidAmount),0):0;
  const refund = o.payments.reduce((s,pr)=>s+n(pr.refundAmount),0);
  const cancelCharge = n(o.cancellationCharge);
  const refundCharge = o.payments.reduce((s,pr)=>s+n(pr.refundCharge),0);
  const effectivePaid = Math.max(0, paid - cancelCharge - refund - refundCharge);
  const refundableSurplus = Math.max(0, effectivePaid - net);
  console.log('=> BILLING SHOULD SHOW:  Gross', gross, '| Discount', discount, '| Net', net, '| Paid(GROSS)', paid, '| Refund', refund, '| Balance', net - effectivePaid);
  console.log('   [effectivePaid', effectivePaid, '| refund-dialog max = overpaid surplus', refundableSurplus, ']');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});
