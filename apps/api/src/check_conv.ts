import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const conv = await prisma.conversation.findUnique({
    where: { id: 'cmpmq4ptq0007iie1jnhvfh2q' }
  })
  console.log("Conversation: ", conv)
  
  const msg = await prisma.message.findUnique({
    where: { id: 'cmpmq5xrx000ziie10gd2mrvu' }
  })
  console.log("Message: ", msg)
}

main().catch(console.error).finally(() => prisma.$disconnect())
