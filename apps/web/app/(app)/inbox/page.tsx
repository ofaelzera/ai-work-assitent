import { MessageSquare } from 'lucide-react'

export default function InboxPage() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center space-y-3 opacity-50">
        <MessageSquare className="h-12 w-12 mx-auto" />
        <p className="text-sm font-medium">Selecione uma conversa</p>
        <p className="text-xs text-muted-foreground">
          Escolha uma conversa na lista ao lado para começar
        </p>
      </div>
    </div>
  )
}
