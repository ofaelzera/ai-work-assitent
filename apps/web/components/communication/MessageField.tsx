'use client'

import dynamic from 'next/dynamic'
import { CommChannel } from './types'
import { WhatsAppEditor } from './WhatsAppEditor'

// RichEditor usa TipTap (browser-only) — carrega sem SSR
const RichEditor = dynamic(() => import('@/components/RichEditor'), { ssr: false })

/**
 * Campo de mensagem que adapta o editor ao canal:
 *  - WhatsApp → editor com formatação WhatsApp (*negrito*, _itálico_…) + prévia
 *  - E-mail   → editor rico (HTML) reaproveitando o RichEditor do projeto
 */
export function MessageField({
  channelType, value, onChange,
}: { channelType: CommChannel; value: string; onChange: (v: string) => void }) {
  if (channelType === 'EMAIL') {
    return <RichEditor value={value} onChange={onChange} placeholder="Conteúdo do e-mail… (formatação rica)" minHeight={140} />
  }
  return <WhatsAppEditor value={value} onChange={onChange} placeholder="Conteúdo da campanha… use a barra para formatar" />
}
