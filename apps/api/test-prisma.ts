import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    const userId = 'clxyxyxyxyx'
    const workspaceId = 'clxyxyxyxyx'
    
    console.log('Testing array_contains on Json? column in MySQL...')
    const queueCount = await prisma.conversation.count({
      where: {
        workspaceId,
        assigneeId: null,
        archived: false,
        status: { in: ['OPEN', 'WAITING'] },
        source: 'LIVE',
        type: 'EXTERNAL',
        unreadCount: { gt: 0 },
        NOT: { externalId: 'status@broadcast' },
        OR: [
          { eligibleAssigneeIds: { equals: Prisma.DbNull } },
          { eligibleAssigneeIds: { array_contains: userId } as any },
        ],
      },
    })
    
    console.log('Success!', queueCount)
  } catch (err: any) {
    console.error('Error in Prisma query:')
    console.error(err.message || err)
  } finally {
    await prisma.$disconnect()
  }
}

main()
