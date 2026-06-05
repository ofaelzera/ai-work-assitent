'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { X, FolderOpen, ChevronRight, FolderPlus, Lock, Users, Globe, Save, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Folder {
  id: string
  name: string
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  parentId: string | null
}

interface Breadcrumb { id: string; name: string }

interface Props {
  messageId: string
  /** Sugestão de nome (vindo do filename do anexo) */
  suggestedFilename?: string
  onClose: () => void
  onSaved?: () => void
}

export default function SaveToLibraryModal({ messageId, suggestedFilename, onClose, onSaved }: Props) {
  const queryClient = useQueryClient()
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [filename, setFilename] = useState(suggestedFilename ?? '')
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderVisibility, setNewFolderVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE')

  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: ['storage-folders', currentFolderId],
    queryFn: () => apiFetch(`/storage/folders${currentFolderId ? `?parentId=${currentFolderId}` : ''}`),
  })

  const { data: breadcrumbs = [] } = useQuery<Breadcrumb[]>({
    queryKey: ['storage-breadcrumb', currentFolderId],
    queryFn: () => currentFolderId
      ? apiFetch(`/storage/breadcrumb/${currentFolderId}`)
      : Promise.resolve([]),
    enabled: !!currentFolderId,
  })

  const createFolder = useMutation({
    mutationFn: () => apiFetch<{ id: string }>('/storage/folders', {
      method: 'POST',
      body: JSON.stringify({
        name: newFolderName.trim(),
        parentId: currentFolderId,
        visibility: newFolderVisibility,
      }),
    }),
    onSuccess: (folder) => {
      // Atualiza cache + entra na nova pasta automaticamente
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      setCurrentFolderId(folder.id)
      setCreatingFolder(false)
      setNewFolderName('')
      toast.success('Pasta criada')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar pasta'),
  })

  const save = useMutation({
    mutationFn: () => apiFetch('/storage/files/from-message', {
      method: 'POST',
      body: JSON.stringify({
        messageId,
        folderId: currentFolderId,
        visibility,
        ...(filename.trim() && { filename: filename.trim() }),
      }),
    }),
    onSuccess: () => {
      // Atualiza cache: lista de arquivos + lista de pastas (pro contador _count.files)
      queryClient.invalidateQueries({ queryKey: ['storage-files'] })
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      toast.success(currentFolderId
        ? `Salvo em "${breadcrumbs.at(-1)?.name ?? 'pasta'}"`
        : 'Salvo em Meus arquivos')
      onSaved?.()
      onClose()
    },
    onError: (e: any) => {
      const detail = e?.body?.error === 'expired' || e?.body?.message?.includes?.('expirada')
        ? 'Mídia expirada no WhatsApp — não dá mais pra baixar'
        : e?.message ?? 'Erro ao salvar'
      toast.error(detail)
    },
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Salvar nos meus arquivos</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Nome do arquivo</label>
            <input value={filename} onChange={e => setFilename(e.target.value)}
              placeholder="Deixe vazio pra usar o nome original"
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Visibilidade</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'PRIVATE' as const, icon: Lock, label: 'Privado', desc: 'Só você', color: 'text-amber-600' },
                { v: 'PUBLIC'  as const, icon: Globe, label: 'Público', desc: 'Todos veem', color: 'text-emerald-600' },
              ]).map(({ v, icon: Icon, label, desc, color }) => (
                <button key={v} onClick={() => setVisibility(v)}
                  className={cn('flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors',
                    visibility === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/30')}>
                  <Icon className={cn('h-3.5 w-3.5', color)} />
                  <div>
                    <p className="font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground italic">Pra compartilhar com pessoas específicas, edite depois em Arquivos.</p>
          </div>

          {/* Picker de pasta */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Pasta destino</label>
              <button
                type="button"
                onClick={() => setCreatingFolder(v => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                <FolderPlus className="h-3 w-3" /> Nova pasta aqui
              </button>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <button onClick={() => setCurrentFolderId(null)}
                className={cn('flex items-center gap-1 px-2 py-1 rounded hover:bg-accent',
                  !currentFolderId && 'font-semibold text-primary')}>
                <FolderOpen className="h-3 w-3" /> Meus arquivos
              </button>
              {breadcrumbs.map((b, i) => (
                <div key={b.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button onClick={() => setCurrentFolderId(b.id)}
                    className={cn('px-2 py-1 rounded hover:bg-accent',
                      i === breadcrumbs.length - 1 && 'font-semibold')}>
                    {b.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Form inline de nova pasta */}
            {creatingFolder && (
              <div className="rounded-lg border bg-primary/5 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <FolderPlus className="h-3.5 w-3.5 text-primary shrink-0" />
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newFolderName.trim()) createFolder.mutate()
                      if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                    }}
                    placeholder="Nome da pasta..."
                    className="flex-1 rounded-md border bg-card px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 flex-1">
                    <button
                      type="button"
                      onClick={() => setNewFolderVisibility('PRIVATE')}
                      className={cn('flex items-center gap-1 px-2 py-1 rounded text-[11px] border',
                        newFolderVisibility === 'PRIVATE' ? 'border-primary bg-card' : 'border-transparent hover:bg-card')}>
                      <Lock className="h-3 w-3 text-amber-600" /> Privada
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewFolderVisibility('PUBLIC')}
                      className={cn('flex items-center gap-1 px-2 py-1 rounded text-[11px] border',
                        newFolderVisibility === 'PUBLIC' ? 'border-primary bg-card' : 'border-transparent hover:bg-card')}>
                      <Globe className="h-3 w-3 text-emerald-600" /> Pública
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCreatingFolder(false); setNewFolderName('') }}
                    className="px-2 py-1 rounded text-[11px] hover:bg-accent text-muted-foreground">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => newFolderName.trim() && !createFolder.isPending && createFolder.mutate()}
                    disabled={!newFolderName.trim() || createFolder.isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-primary text-primary-foreground disabled:opacity-50">
                    <Check className="h-3 w-3" />
                    {createFolder.isPending ? 'Criando...' : 'Criar'}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de subpastas pra navegar */}
            <div className="rounded-lg border max-h-40 overflow-y-auto">
              {folders.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">
                  {currentFolderId ? 'Sem subpastas — vai salvar nesta pasta' : 'Sem pastas — vai salvar na raiz'}
                </p>
              ) : (
                folders.map(f => (
                  <button key={f.id}
                    onClick={() => setCurrentFolderId(f.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-xs text-left border-b last:border-b-0">
                    <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="flex-1 truncate font-medium">{f.name}</span>
                    {f.visibility === 'PUBLIC' && <Globe className="h-3 w-3 text-emerald-500" />}
                    {f.visibility === 'SHARED' && <Users className="h-3 w-3 text-blue-500" />}
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t shrink-0">
          <p className="text-xs text-muted-foreground truncate">
            Vai salvar em <strong>{breadcrumbs.at(-1)?.name ?? 'Meus arquivos'}</strong>
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
            <button
              onClick={() => !save.isPending && save.mutate()}
              disabled={save.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />
              {save.isPending ? 'Salvando...' : 'Salvar aqui'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
