'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSSE } from '@/lib/sse'
import { isDesktop, notifyNative, setUnreadBadge } from '@/lib/desktop'

export function NotificationManager() {
  const pathname = usePathname()
  const originalTitleRef = useRef<string>('')
  const blinkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  
  // Guardamos o estado de quantas não lidas "globais" recebemos desde que a aba perdeu o foco
  const [unreadSinceBlur, setUnreadSinceBlur] = useState(0)
  const [lastSenderName, setLastSenderName] = useState<string | null>(null)

  useEffect(() => {
    // Inicializa o áudio
    audioRef.current = new Audio('/notification.wav')
    // Salva o título original
    if (!originalTitleRef.current) {
      originalTitleRef.current = document.title || 'Work Assistant'
    }

    // Solicitar permissão de notificação nativa ao focar/clicar na janela pela primeira vez
    const requestPerm = () => {
      // No desktop a permissão é do SO, gerenciada pelo plugin nativo
      if (isDesktop()) return
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
      }
    }
    
    // Tentar pedir permissão quando a janela ganha foco ou click
    window.addEventListener('focus', requestPerm)
    window.addEventListener('click', requestPerm, { once: true })

    return () => {
      window.removeEventListener('focus', requestPerm)
      window.removeEventListener('click', requestPerm)
      stopBlink()
    }
  }, [])

  // Gerencia o reset quando a janela ganha foco
  useEffect(() => {
    const handleFocus = () => {
      setUnreadSinceBlur(0)
      setLastSenderName(null)
      stopBlink()
      setUnreadBadge(0)
    }
    window.addEventListener('focus', handleFocus)
    
    // Se a janela já está visível agora, limpa
    if (document.visibilityState === 'visible') {
      handleFocus()
    }
    
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  // Badge nativo de não lidas (dock/tray) no app desktop
  useEffect(() => {
    setUnreadBadge(unreadSinceBlur)
  }, [unreadSinceBlur])

  // Pisca-pisca no título da aba
  useEffect(() => {
    if (unreadSinceBlur > 0) {
      if (!blinkIntervalRef.current) {
        let showNew = true
        blinkIntervalRef.current = setInterval(() => {
          const titleMsg = lastSenderName ? `de ${lastSenderName}` : ''
          document.title = showNew ? `(${unreadSinceBlur}) Nova Mensagem ${titleMsg}`.trim() : originalTitleRef.current
          showNew = !showNew
        }, 1000)
      }
    } else {
      stopBlink()
    }
  }, [unreadSinceBlur, lastSenderName])

  const stopBlink = () => {
    if (blinkIntervalRef.current) {
      clearInterval(blinkIntervalRef.current)
      blinkIntervalRef.current = null
    }
    if (originalTitleRef.current) {
      document.title = originalTitleRef.current
    }
  }

  useSSE((ev) => {
    // Apenas mensagens recebidas importam para o alerta
    if (ev.type !== 'message.received') return

    // O payload recebido: { conversationId, body, direction, senderName, ... }
    const { conversationId, direction, body, senderName } = (ev.payload as any) || {}
    
    // Só notificamos INBOUND
    if (direction !== 'INBOUND') return

    // Verifica se a conversa atual é a mesma que recebeu a mensagem
    const isCurrentConversation = pathname.startsWith(`/inbox/${conversationId}`) || pathname.startsWith(`/chat/${conversationId}`)
    
    // Se a aba estiver visível E o usuário já estiver na tela da conversa, NÃO toca som/notificação
    const isWindowActive = document.visibilityState === 'visible' && document.hasFocus()
    if (isWindowActive && isCurrentConversation) {
      return
    }

    // Se chegou até aqui, o usuário precisa ser notificado (está em outra aba ou outra conversa)

    // 1. Incrementa contador (título piscando / badge do desktop) SÓ quando a janela
    // não está em foco. Com a janela ativa o usuário já vê os indicadores do inbox,
    // e o reset depende do evento 'focus' — que nunca dispara se ela já está focada
    // (badge "fantasma" que não some).
    if (!isWindowActive) {
      setUnreadSinceBlur(prev => prev + 1)
      if (senderName) setLastSenderName(senderName)
    }

    // 2. Tocar som
    if (audioRef.current) {
      // O navegador pode bloquear o áudio se não houve interação previa
      audioRef.current.currentTime = 0; // Reseta pro início caso seja disparado várias vezes seguidas
      audioRef.current.play().catch((err) => {
        console.warn('Bloqueado autoplay de áudio pelo navegador:', err)
      })
    }

    // 3. Mostrar Notificação Desktop
    const title = senderName ? `Nova mensagem de ${senderName}` : 'Nova mensagem recebida'
    if (isDesktop()) {
      // App desktop: notificação nativa do SO via Tauri
      notifyNative(title, body || 'Você tem uma nova mensagem.')
      return
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      // Previne várias notificações do mesmo remetente ao mesmo tempo
      const notification = new Notification(title, {
        body: body || 'Você tem uma nova mensagem.',
        icon: '/favicon.ico',
        tag: `msg-${conversationId}`, // Usa a mesma tag para sobrescrever e não inundar a tela
      })

      notification.onclick = () => {
        window.focus()
        // Opcional: navegar direto para a conversa, mas como isso é global, precisaria usar o router do Next. 
        // Mas a pessoa já clicou na notificação, a aba ganhou foco.
        notification.close()
      }
    }
  })

  // Componente invisível
  return null
}
