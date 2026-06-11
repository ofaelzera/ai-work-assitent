'use client'

import { ListChecks } from 'lucide-react'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { BroadcastLists } from '@/components/communication/BroadcastLists'

export default function BroadcastListsPage() {
  return (
    <AdminPageLayout
      title="Listas de Transmissão"
      icon={ListChecks}
      description="Listas reutilizáveis de contatos cadastrados para usar em campanhas"
      maxWidth="5xl"
    >
      <BroadcastLists />
    </AdminPageLayout>
  )
}
