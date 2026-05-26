import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const id = 'cmpmq4ptq0007iie1jnhvfh2q'
  
  const c = await prisma.contact.findUnique({ where: { id } })
  if (c) console.log("It's a contact:", c)
  
  const ch = await prisma.channel.findUnique({ where: { id } })
  if (ch) console.log("It's a channel:", ch)
  
  const comp = await prisma.company.findUnique({ where: { id } })
  if (comp) console.log("It's a company:", comp)
  
  const msg = await prisma.message.findUnique({ where: { id } })
  if (msg) console.log("It's a message:", msg)
}

main().catch(console.error).finally(() => prisma.$disconnect())
