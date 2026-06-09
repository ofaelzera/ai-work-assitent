'use client'

import { useState } from 'react'
import { Megaphone, Send, ListChecks, LayoutDashboard, KeyRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { CampaignsTab } from './CampaignsTab'
import { ListsTab } from './ListsTab'
import { QueueTab } from './QueueTab'
import { DashboardTab } from './DashboardTab'
import { ApiKeysTab } from './ApiKeysTab'

type Tab = 'campaigns' | 'lists' | 'queue' | 'dashboard' | 'apikeys'

const TABS: { key: Tab; label: string; icon: typeof Send }[] = [
  { key: 'campaigns', label: 'Campanhas', icon: Send },
  { key: 'lists', label: 'Listas de Transmissão', icon: ListChecks },
  { key: 'queue', label: 'Fila de Mensagens', icon: Megaphone },
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'apikeys', label: 'API Keys', icon: KeyRound },
]

export default function CampaignsPage() {
  const [tab, setTab] = useState<Tab>('campaigns')

  return (
    <AdminPageLayout
      title="Central de Comunicação"
      icon={Megaphone}
      description="Campanhas, listas de transmissão, fila de envios e API de integração"
      maxWidth="7xl"
    >
      <div className="flex items-center gap-1 border-b overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'lists' && <ListsTab />}
        {tab === 'queue' && <QueueTab />}
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'apikeys' && <ApiKeysTab />}
      </div>
    </AdminPageLayout>
  )
}
