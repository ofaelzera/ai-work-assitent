'use client'

import { Megaphone } from 'lucide-react'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { CampaignsList } from '@/components/communication/CampaignsList'

export default function CampaignsPage() {
  return (
    <AdminPageLayout
      title="Campanhas"
      icon={Megaphone}
      description="Crie, agende e dispare campanhas em massa por WhatsApp e e-mail"
      maxWidth="6xl"
    >
      <CampaignsList />
    </AdminPageLayout>
  )
}
