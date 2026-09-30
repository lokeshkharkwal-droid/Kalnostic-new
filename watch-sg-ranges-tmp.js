// Polls the SG parameter's active reference-range count every 3s and prints
// a timestamped alert the moment it changes, to catch whatever is
// overwriting it in the act.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const PARAM_ID = '04501b11-f88e-435d-98ed-27f1f78bb6fe';

let lastCount = null;
async function poll() {
  const count = await prisma.labTestReferenceRange.count({
    where: { paramId: PARAM_ID, deletedAt: null },
  });
  const now = new Date().toISOString();
  if (lastCount === null) {
    console.log(`[${now}] baseline: ${count} active ranges`);
  } else if (count !== lastCount) {
    console.log(`[${now}] *** CHANGED: ${lastCount} -> ${count} ***`);
  }
  lastCount = count;
}

(async () => {
  console.log('Watching SG active range count every 3s. Ctrl+C to stop.');
  await poll();
  setInterval(poll, 3000);
})();
