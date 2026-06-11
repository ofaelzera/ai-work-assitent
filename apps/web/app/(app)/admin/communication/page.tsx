'use client'

import { useState } from 'react'
import { Radio, LayoutDashboard, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { CommDashboard } from '@/components/communication/CommDashboard'
import { MessageQueue } from '@/components/communication/MessageQueue'

type Tab = 'dashboard' | 'queue'

export default function CommunicationPage() {
  const [tab, setTab] = useState<Tab>('dashboard')

  return (
    <AdminPageLayout
      title="Central de Comunicação"
      icon={Radio}
      description="Métricas de envios e fila de mensagens de todos os módulos"
      maxWidth="7xl"
    >
      <div className="flex items-center gap-1 border-b">
        <TabBtn active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={LayoutDashboard}>Dashboard</TabBtn>
        <TabBtn active={tab === 'queue'} onClick={() => setTab('queue')} icon={Inbox}>Fila de Mensagens</TabBtn>
      </div>
      <div className="pt-2">
        {tab === 'dashboard' && <CommDashboard />}
        {tab === 'queue' && <MessageQueue />}
      </div>
    </AdminPageLayout>
  )
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Inbox; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  )
}
