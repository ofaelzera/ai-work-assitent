'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { RoomList } from '../_components/RoomList'
import { ChatView } from '../_components/ChatView'
import { NewRoomModal } from '../_components/NewRoomModal'

export default function ChatRoomPage() {
  const params = useParams<{ roomId: string }>()
  const [newOpen, setNewOpen] = useState(false)
  return (
    <div className="flex flex-1 h-full">
      <RoomList onNew={() => setNewOpen(true)} />
      <ChatView roomId={params.roomId} />
      <NewRoomModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
