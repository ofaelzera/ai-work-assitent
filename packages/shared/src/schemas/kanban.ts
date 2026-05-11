import { z } from 'zod'

export const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export const CreateBoardSchema = z.object({
  name: z.string().min(1).max(100),
})

export const CreateCardSchema = z.object({
  columnId: z.string().cuid(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: PriorityEnum.default('MEDIUM'),
  dueDate: z.string().datetime().optional(),
  contactId: z.string().cuid().optional(),
  conversationId: z.string().cuid().optional(),
})

export const UpdateCardSchema = CreateCardSchema.partial().omit({ columnId: true })

export const MoveCardSchema = z.object({
  columnId: z.string().cuid(),
  position: z.number().int().min(0),
})

export type CreateCardInput = z.infer<typeof CreateCardSchema>
export type UpdateCardInput = z.infer<typeof UpdateCardSchema>
export type MoveCardInput = z.infer<typeof MoveCardSchema>
