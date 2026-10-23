import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const event = await prisma.event.create({
    data: {
      title: 'Test Event',
      location: 'Online',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      organizerId: user.id,
      ticketTypes: { create: [{ name: 'VIP', price: 100, totalQuantity: 1, availableQuantity: 1 }] }
    },
    include: { ticketTypes: true }
  });

  const ticketType = event.ticketTypes[0];

  // Tạo order (giả lập đặt vé)
  await prisma.order.create({
    data: {
      userId: user.id,
      totalAmount: 100,
      status: 'CONFIRMED',
      tickets: { create: [{ ticketTypeId: ticketType.id }] }
    }
  });

  // Thử update để xóa ticketTypes
  try {
    await prisma.event.update({
      where: { id: event.id },
      data: {
        ticketTypes: {
          deleteMany: {}
        }
      }
    });
    console.log('ERROR: deleteMany should have failed!');
  } catch (e: any) {
    console.log('Expected error code:', e.code);
  }
}

main().catch(e => console.error('Test error:', e));
