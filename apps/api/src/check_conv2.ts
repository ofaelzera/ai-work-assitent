import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const conv = await prisma.conversation.findUnique({
    where: { id: 'cmpcpf4c500gxcsyym2n1mryj' }
  })
  console.log("Conversation of message: ", conv)
}

main().catch(console.error).finally(() => prisma.$disconnect())
