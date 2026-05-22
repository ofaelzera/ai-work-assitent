'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Save, UserRound, MessageSquare } from 'lucide-react'
import MessageTemplateField from '@/components/MessageTemplateField'
import { useAuthStore } from '@/store/auth'

interface UserSettings {
  welcomeMessage?: string | null
  closingMessage?: string | null
  signature?: string | null
}

function Section({ title, description, icon: Icon, children }: {
  title: string
  description?: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b bg-muted/20 flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="font-semibold text-sm">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

interface MeProfile { id: string; name: string; email: string; role: string }

export default function ProfilePage() {
  const queryClient = useQueryClient()
  const meAuth = useAuthStore(s => s.user)

  const { data: profile } = useQuery<MeProfile>({
    queryKey: ['me-profile'],
    queryFn: () => apiFetch(`/users/${meAuth!.sub}`),
    enabled: !!meAuth?.sub,
  })

  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ['user-settings'],
    queryFn: () => apiFetch('/users/me/settings'),
  })

  // Estado local pra editar sem disparar mutation a cada keystroke
  const [welcome, setWelcome] = useState('')
  const [closing, setClosing] = useState('')

  useEffect(() => {
    if (settings) {
      setWelcome(settings.welcomeMessage ?? '')
      setClosing(settings.closingMessage ?? '')
    }
  }, [settings])

  const save = useMutation({
    mutationFn: (patch: Partial<UserSettings>) =>
      apiFetch('/users/me/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
      toast.success('Configurações salvas')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  const dirty = (welcome !== (settings?.welcomeMessage ?? '')) || (closing !== (settings?.closingMessage ?? ''))

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">Meu perfil</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Personalize suas mensagens automáticas como atendente.
          </p>
        </div>

        {/* Identidade */}
        <Section title="Identidade" icon={UserRound} description="Como você aparece pra clientes e colegas">
          <div className="space-y-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs space-y-1">
              <p className="text-muted-foreground">Nome: <span className="font-semibold text-foreground">{profile?.name ?? '—'}</span></p>
              <p className="text-muted-foreground">Email: <span className="font-mono text-foreground">{profile?.email ?? '—'}</span></p>
              <p className="text-muted-foreground">Função: <span className="font-semibold text-foreground">{meAuth?.role ?? '—'}</span></p>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Pra alterar nome ou senha, vá em <strong>Configurações</strong>.
            </p>
          </div>
        </Section>

        {/* Mensagens automáticas */}
        <Section title="Mensagens automáticas" icon={MessageSquare}
          description="Enviadas em momentos específicos do atendimento. Use variáveis pra personalizar.">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="space-y-5">
              <MessageTemplateField
                label="Apresentação ao assumir conversa"
                helperText="Enviada automaticamente quando você clica em 'Assumir atendimento'. Adicional à mensagem de boas-vindas do canal."
                value={welcome}
                onChange={setWelcome}
                placeholder="Olá {cliente}, aqui é {atendente} 👋 Em que posso ajudar?"
              />
              <MessageTemplateField
                label="Mensagem ao finalizar conversa"
                helperText="Substitui a mensagem padrão do canal. Deixe vazio pra usar a do canal."
                value={closing}
                onChange={setClosing}
                placeholder="Por hoje encerro o atendimento. Qualquer dúvida estou à disposição! - {atendente}"
              />

              <div className="flex justify-end pt-2 border-t">
                <button
                  onClick={() => save.mutate({
                    welcomeMessage: welcome.trim() || null,
                    closingMessage: closing.trim() || null,
                  })}
                  disabled={!dirty || save.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" />
                  {save.isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
