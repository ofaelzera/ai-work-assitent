import { z } from 'zod'

export const ChatRoleEnum = z.enum(['OWNER', 'MEMBER'])
export const ConversationTypeEnum = z.enum(['EXTERNAL', 'DIRECT', 'GROUP'])

/**
 * Cria uma sala interna.
 * - 1 user em userIds → DIRECT (idempotente; reabre conversa existente entre os 2).
 * - 2+ userIds → GROUP (name obrigatório).
 * O criador entra automaticamente como OWNER.
 */
export const CreateChatRoomSchema = z
  .object({
    userIds: z.array(z.string().cuid()).min(1).max(50),
    name: z.string().min(1).max(80).optional(),
  })
  .refine(
    (v) => v.userIds.length === 1 || (v.name && v.name.length > 0),
    { message: 'Nome é obrigatório para grupos (2+ participantes)', path: ['name'] },
  )

export const SendChatMessageSchema = z.object({
  body: z.string().min(1).max(8000),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
        mime: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .optional(),
  replyToId: z.string().cuid().optional(),
})

export const RenameChatRoomSchema = z.object({
  name: z.string().min(1).max(80),
})

export const AddParticipantSchema = z.object({
  userId: z.string().cuid(),
  role: ChatRoleEnum.default('MEMBER'),
})

export const MarkReadSchema = z.object({
  /** ID da última mensagem lida; se omitido, marca a sala inteira como lida (now). */
  uptoMessageId: z.string().cuid().optional(),
})

export type CreateChatRoomInput = z.infer<typeof CreateChatRoomSchema>
export type SendChatMessageInput = z.infer<typeof SendChatMessageSchema>
export type RenameChatRoomInput = z.infer<typeof RenameChatRoomSchema>
export type AddParticipantInput = z.infer<typeof AddParticipantSchema>
export type MarkReadInput = z.infer<typeof MarkReadSchema>

/**
 * Evento de "fulano está digitando..." — não é persistido, apenas trafega via SSE/eventBus.
 */
export interface TypingEvent {
  conversationId: string
  userId: string
  userName: string
  /** 'start' | 'stop' */
  action: 'start' | 'stop'
}
