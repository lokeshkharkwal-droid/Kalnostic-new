const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const t = await prisma.pdfReportTemplate.findUnique({
    where: { id: '6df019b7-fcb3-4102-8a3b-741cdeb8937b' },
  });
  const body = t.meta.body_html;
  const idx = body.indexOf('{references}');
  console.log(body.slice(Math.max(0, idx - 400), idx + 200));
  await prisma.$disconnect();
})();
