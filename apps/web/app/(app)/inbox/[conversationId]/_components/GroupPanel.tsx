'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  X, Users, Pencil, Camera, Crown, ShieldCheck, UserX, UserPlus,
  Link as LinkIcon, RefreshCw, LogOut, Save, Copy, Check, Building2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPhone } from '@/lib/phone'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface GroupParticipant {
  jid: string
  number: string
  admin: 'admin' | 'superadmin' | null
  name: string | null
  contactId: string | null
  avatarUrl: string | null
}

interface GroupData {
  info: {
    id?: string
    subject?: string
    subjectOwner?: string
    subjectTime?: number
    desc?: string
  } | null
  participants: GroupParticipant[]
}

interface Props {
  conversationId: string
  groupAvatarUrl: string | null
  currentCompanyId: string | null
  onClose: () => void
}

interface Company { id: string; name: string; color: string }

export function GroupPanel({ conversationId, groupAvatarUrl, currentCompanyId, onClose }: Props) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editingSubject, setEditingSubject] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [subject, setSubject] = useState('')
  const [desc, setDesc] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  // ESC fecha o painel
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const { data, isLoading, refetch } = useQuery<GroupData>({
    queryKey: ['group-info', conversationId],
    queryFn: () => apiFetch<GroupData>(`/conversations/${conversationId}/group`),
    staleTime: 30_000,
  })

  // Sincroniza state com dados carregados
  useEffect(() => {
    if (data?.info) {
      setSubject(data.info.subject ?? '')
      setDesc(data.info.desc ?? '')
    }
  }, [data?.info?.subject, data?.info?.desc])

  const updateGroupMut = useMutation({
    mutationFn: (body: { subject?: string; description?: string }) =>
      apiFetch(`/conversations/${conversationId}/group`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-info', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Grupo atualizado')
      setEditingSubject(false)
      setEditingDesc(false)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao atualizar'),
  })

  const updatePictureMut = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return apiFetch(`/conversations/${conversationId}/group/picture`, { method: 'POST', body: form })
    },
    onSuccess: () => {
      toast.success('Foto atualizada — pode levar alguns segundos para aparecer')
      // Não tem como saber a nova URL ainda; refresh do grupo eventualmente trará
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao atualizar foto'),
  })

  const syncAvatarMut = useMutation({
    mutationFn: () => apiFetch<{ avatarUrl: string }>(`/conversations/${conversationId}/group/sync-avatar`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Foto sincronizada com sucesso')
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao sincronizar foto'),
  })

  const membersMut = useMutation({
    mutationFn: (body: { action: 'add' | 'remove' | 'promote' | 'demote'; participants: string[] }) =>
      apiFetch(`/conversations/${conversationId}/group/members`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['group-info', conversationId] })
      toast.success(
        vars.action === 'add' ? 'Membro(s) adicionado(s)' :
        vars.action === 'remove' ? 'Membro removido' :
        vars.action === 'promote' ? 'Promovido a admin' :
        'Removido de admin'
      )
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao alterar membros'),
  })

  const leaveMut = useMutation({
    mutationFn: () => apiFetch(`/conversations/${conversationId}/group/leave`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Saiu do grupo')
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao sair'),
  })

  const inviteQuery = useQuery<{ inviteUrl: string; inviteCode: string }>({
    queryKey: ['group-invite', conversationId],
    queryFn: () => apiFetch(`/conversations/${conversationId}/group/invite`),
    enabled: showInvite,
    staleTime: 60_000,
  })

  const revokeInviteMut = useMutation({
    mutationFn: () =>
      apiFetch<{ inviteUrl: string; inviteCode: string }>(`/conversations/${conversationId}/group/invite/revoke`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-invite', conversationId] })
      toast.success('Link revogado e regenerado')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao revogar'),
  })

  // ─── Empresa vinculada ──────────────────────────────────────────────────────
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: () => apiFetch<Company[]>('/companies'),
    staleTime: 60_000,
  })

  const companyMut = useMutation({
    mutationFn: (companyId: string | null) =>
      apiFetch(`/conversations/${conversationId}/company`, {
        method: 'PATCH',
        body: JSON.stringify({ companyId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Empresa atualizada')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao vincular empresa'),
  })

  const isPending = updateGroupMut.isPending || updatePictureMut.isPending || membersMut.isPending

  const filteredParticipants = (data?.participants ?? []).filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (p.name ?? '').toLowerCase().includes(q) || p.number.includes(q)
  })

  // Conta admins primeiro, depois alfabético
  const sortedParticipants = filteredParticipants.slice().sort((a, b) => {
    if (!!a.admin !== !!b.admin) return a.admin ? -1 : 1
    return (a.name ?? a.number).localeCompare(b.name ?? b.number)
  })

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-end" onClick={onClose}>
      <div
        className="bg-card w-full max-w-md h-full shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold flex-1">Detalhes do grupo</h2>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            title="Recarregar"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && !data ? (
            <div className="text-center text-sm text-muted-foreground py-12">Carregando…</div>
          ) : (
            <>
              {/* Foto + nome */}
              <div className="flex flex-col items-center pt-6 pb-4 px-4 border-b">
                <div className="relative group">
                  <div className="h-24 w-24 rounded-full bg-muted overflow-hidden flex items-center justify-center text-2xl font-medium text-muted-foreground">
                    {groupAvatarUrl
                      ? <img src={groupAvatarUrl} alt="Grupo" className="h-full w-full object-cover" />
                      : <Users className="h-12 w-12" />}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={updatePictureMut.isPending}
                    className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white disabled:opacity-30"
                    title="Trocar foto"
                  >
                    <Camera className="h-5 w-5" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) updatePictureMut.mutate(f)
                      if (e.target) e.target.value = ''
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-center">
                  <button
                    onClick={() => syncAvatarMut.mutate()}
                    disabled={syncAvatarMut.isPending}
                    className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                    title="Sincronizar foto do WhatsApp"
                  >
                    <RefreshCw className={cn('h-3 w-3', syncAvatarMut.isPending && 'animate-spin')} />
                    Sincronizar
                  </button>
                </div>

                {/* Subject (editável) */}
                <div className="mt-4 w-full text-center">
                  {editingSubject ? (
                    <div className="flex items-center gap-2 px-2">
                      <input
                        autoFocus
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && subject.trim()) updateGroupMut.mutate({ subject: subject.trim() })
                          if (e.key === 'Escape') setEditingSubject(false)
                        }}
                        maxLength={100}
                        className="flex-1 text-center text-lg font-semibold bg-background border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={() => updateGroupMut.mutate({ subject: subject.trim() })}
                        disabled={!subject.trim() || isPending}
                        className="p-1 rounded text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setEditingSubject(false); setSubject(data?.info?.subject ?? '') }}
                        className="p-1 rounded text-muted-foreground hover:bg-accent"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingSubject(true)}
                      className="inline-flex items-center gap-1.5 text-lg font-semibold hover:text-primary group/edit"
                    >
                      {data?.info?.subject ?? '(sem nome)'}
                      <Pencil className="h-3.5 w-3.5 opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                    </button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-1">
                  {(data?.participants ?? []).length} participantes
                </p>
              </div>

              {/* Descrição */}
              <div className="px-4 py-3 border-b">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Descrição</h3>
                  {!editingDesc && (
                    <button
                      onClick={() => setEditingDesc(true)}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                  )}
                </div>
                {editingDesc ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      spellCheck
                      lang="pt-BR"
                      value={desc}
                      onChange={e => setDesc(e.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="Adicione uma descrição…"
                      className="w-full text-sm bg-background border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => { setEditingDesc(false); setDesc(data?.info?.desc ?? '') }}
                        className="px-3 py-1 text-xs rounded-md hover:bg-accent"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => updateGroupMut.mutate({ description: desc })}
                        disabled={isPending}
                        className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {data?.info?.desc || <span className="italic">Sem descrição</span>}
                  </p>
                )}
              </div>

              {/* Empresa vinculada */}
              <div className="px-4 py-3 border-b">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Empresa
                </h3>
                <select
                  value={currentCompanyId ?? ''}
                  onChange={e => companyMut.mutate(e.target.value || null)}
                  disabled={companyMut.isPending}
                  className="w-full text-sm bg-background border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                >
                  <option value="">— Sem empresa —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Vincular ajuda a agrupar conversas deste grupo com outras conversas da mesma empresa.
                </p>
              </div>

              {/* Convite */}
              <div className="px-4 py-3 border-b">
                <button
                  onClick={() => setShowInvite(v => !v)}
                  className="w-full flex items-center justify-between text-sm font-medium text-foreground hover:text-primary"
                >
                  <span className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" />
                    Link de convite
                  </span>
                  <span className="text-xs text-muted-foreground">{showInvite ? 'Ocultar' : 'Mostrar'}</span>
                </button>
                {showInvite && (
                  <div className="mt-2 space-y-2">
                    {inviteQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">Carregando…</p>
                    ) : inviteQuery.data ? (
                      <>
                        <div className="flex items-center gap-2 bg-muted/50 rounded-md px-2 py-1.5">
                          <code className="flex-1 text-xs truncate">{inviteQuery.data.inviteUrl}</code>
                          <button
                            onClick={() => handleCopy(inviteQuery.data!.inviteUrl)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <button
                          onClick={() => revokeInviteMut.mutate()}
                          disabled={revokeInviteMut.isPending}
                          className="text-xs text-amber-600 hover:underline disabled:opacity-50"
                        >
                          Revogar e gerar novo link
                        </button>
                      </>
                    ) : inviteQuery.error ? (
                      <p className="text-xs text-red-500">{(inviteQuery.error as any)?.message ?? 'Erro ao buscar convite'}</p>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Participantes */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Participantes ({(data?.participants ?? []).length})
                  </h3>
                </div>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar membro…"
                  className="w-full text-sm bg-background border rounded-md px-3 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <ul className="space-y-0.5">
                  {sortedParticipants.map(p => (
                    <li key={p.jid} className="flex items-center gap-2 py-1.5 px-1 rounded-md hover:bg-accent group">
                      <div className="h-8 w-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
                        {p.avatarUrl
                          ? <img src={p.avatarUrl} alt={p.name ?? p.number} className="h-full w-full object-cover" />
                          : (p.name ?? p.number).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm truncate">{p.name ?? formatPhone(p.number)}</span>
                          {p.admin === 'superadmin' && (
                            <Crown className="h-3 w-3 text-amber-500" aria-label="Criador" />
                          )}
                          {p.admin === 'admin' && (
                            <ShieldCheck className="h-3 w-3 text-blue-500" aria-label="Admin" />
                          )}
                        </div>
                        {p.name && <p className="text-[11px] text-muted-foreground truncate">{formatPhone(p.number)}</p>}
                      </div>

                      {/* Ações por membro */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {p.admin ? (
                          <button
                            onClick={() => membersMut.mutate({ action: 'demote', participants: [p.number] })}
                            disabled={isPending}
                            title="Remover admin"
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => membersMut.mutate({ action: 'promote', participants: [p.number] })}
                            disabled={isPending}
                            title="Tornar admin"
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <Crown className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              type: 'danger',
                              title: `Remover ${p.name ?? formatPhone(p.number)} do grupo?`,
                              message: 'O membro será removido imediatamente. Você pode adicioná-lo novamente depois.',
                              confirmLabel: 'Remover',
                            })
                            if (ok) membersMut.mutate({ action: 'remove', participants: [p.number] })
                          }}
                          disabled={isPending}
                          title="Remover do grupo"
                          className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Footer — sair do grupo */}
        <div className="px-4 py-3 border-t shrink-0">
          <button
            onClick={async () => {
              const ok = await confirm({
                type: 'danger',
                title: 'Sair do grupo?',
                message: 'Você não receberá mais mensagens deste grupo e a conversa será finalizada no sistema.',
                warning: 'Para voltar ao grupo, alguém precisará adicionar você novamente.',
                confirmLabel: 'Sair do grupo',
              })
              if (ok) leaveMut.mutate()
            }}
            disabled={leaveMut.isPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            Sair do grupo
          </button>
        </div>
      </div>
    </div>
  )
}
