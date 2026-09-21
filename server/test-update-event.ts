import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  
  // Tạo event với 1 ticketType có 5 vé
  const event = await prisma.event.create({
    data: {
      title: 'Concert Test',
      location: 'Online',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      organizerId: user.id,
      ticketTypes: { create: [{ name: 'VIP', price: 100, totalQuantity: 5, availableQuantity: 5 }] }
    },
    include: { ticketTypes: true }
  });

  const tt = event.ticketTypes[0];
  console.log(`Created event with ${tt.totalQuantity} ${tt.name} tickets`);

  // Bán 2 vé
  await prisma.$transaction(async (tx) => {
    await tx.ticketType.update({
      where: { id: tt.id },
      data: { availableQuantity: { decrement: 2 } }
    });
    await tx.order.create({
      data: {
        userId: user.id,
        totalAmount: 200,
        status: 'CONFIRMED',
        tickets: { create: [
          { ticketTypeId: tt.id },
          { ticketTypeId: tt.id }
        ]}
      }
    });
  });
  
  console.log('Sold 2 tickets, remaining:', 5 - 2);

  // Kiểm tra available trước update
  const check = await prisma.ticketType.findUnique({
    where: { id: tt.id },
    select: { availableQuantity: true, totalQuantity: true }
  });
  console.log(`Before update: available=${check.availableQuantity}, total=${check.totalQuantity}`);

  // Dọn dẹp
  await prisma.ticket.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.ticketType.deleteMany({});
  await prisma.event.delete({ where: { id: event.id } });
  
  console.log('Test cleanup complete');
}

main().catch(e => console.error('Error:', e));
