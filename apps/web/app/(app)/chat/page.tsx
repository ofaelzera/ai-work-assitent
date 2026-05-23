'use client'

import { useState } from 'react'
import { RoomList } from './_components/RoomList'
import { NewRoomModal } from './_components/NewRoomModal'
import { MessageSquare } from 'lucide-react'

export default function ChatPage() {
  const [newOpen, setNewOpen] = useState(false)
  return (
    <div className="flex flex-1 h-full">
      <RoomList onNew={() => setNewOpen(true)} />
      <div className="flex-1 flex items-center justify-center bg-accent/10">
        <div className="text-center space-y-3 opacity-60">
          <MessageSquare className="h-12 w-12 mx-auto" />
          <p className="text-sm font-medium">Selecione uma conversa</p>
          <p className="text-xs text-muted-foreground">
            Ou crie uma nova clicando no botão +.
          </p>
        </div>
      </div>
      <NewRoomModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
