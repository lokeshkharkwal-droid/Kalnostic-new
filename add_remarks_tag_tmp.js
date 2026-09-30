const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const t = await prisma.pdfReportTemplate.findUnique({
    where: { id: '6df019b7-fcb3-4102-8a3b-741cdeb8937b' },
  });
  const originalBody = t.meta.body_html;
  console.log('ORIGINAL body_html (first 2000 chars):');
  console.log(originalBody.slice(0, 2000));
  await prisma.$disconnect();
})();
