'use client'

import ConversationSidebar from '@/components/ConversationSidebar'

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden">
      <ConversationSidebar view="conversations" />
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
