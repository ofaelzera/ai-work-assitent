'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  X, FolderOpen, ChevronRight, FolderPlus, Lock, Users, Globe, Check, Move,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Folder {
  id: string
  name: string
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  parentId: string | null
}

interface Breadcrumb { id: string; name: string }

type ItemType = 'folder' | 'file'

interface Props {
  itemType: ItemType
  itemId: string
  itemName: string
  /** ID atual do parent — pra evitar mostrar como destino (e evitar ciclo se for folder) */
  currentParentId?: string | null
  onClose: () => void
}

/**
 * Modal pra mover pasta OU arquivo pra outro lugar da biblioteca.
 * - Pasta: usa PATCH /storage/folders/:id { parentId }
 * - Arquivo: usa PATCH /storage/files/:id { folderId }
 * - Permite criar nova pasta no contexto atual antes de mover
 * - Pra pasta: previne mover pra si mesma ou pra uma descendente (validado no backend)
 */
export default function MoveToFolderModal({
  itemType,
  itemId,
  itemName,
  currentParentId,
  onClose,
}: Props) {
  const queryClient = useQueryClient()
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

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
        visibility: 'PRIVATE',
      }),
    }),
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      setCurrentFolderId(folder.id)
      setCreatingFolder(false)
      setNewFolderName('')
      toast.success('Pasta criada')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar pasta'),
  })

  const moveMutation = useMutation({
    mutationFn: () => {
      const endpoint = itemType === 'folder' ? `/storage/folders/${itemId}` : `/storage/files/${itemId}`
      const bodyKey = itemType === 'folder' ? 'parentId' : 'folderId'
      return apiFetch(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({ [bodyKey]: currentFolderId }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      queryClient.invalidateQueries({ queryKey: ['storage-files'] })
      const destName = breadcrumbs.at(-1)?.name ?? 'Meus arquivos'
      toast.success(`Movido para "${destName}"`)
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao mover'),
  })

  // Pra pasta: não pode mover pra ela mesma
  const isSelf = itemType === 'folder' && currentFolderId === itemId
  // Mesmo destino atual: nada a fazer
  const isSameAsNow = (currentParentId ?? null) === currentFolderId
  const canMove = !isSelf && !isSameAsNow && !moveMutation.isPending

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-surface rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Move className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="font-semibold text-sm">Mover {itemType === 'folder' ? 'pasta' : 'arquivo'}</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[300px]">"{itemName}"</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Destino</label>
            <button type="button" onClick={() => setCreatingFolder(v => !v)}
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

          {/* Form inline nova pasta */}
          {creatingFolder && (
            <div className="rounded-lg border bg-primary/5 p-2.5 flex items-center gap-2">
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
              <button onClick={() => newFolderName.trim() && createFolder.mutate()}
                disabled={!newFolderName.trim() || createFolder.isPending}
                className="px-2 py-1 rounded text-[11px] font-semibold bg-primary text-primary-foreground disabled:opacity-50">
                Criar
              </button>
              <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }}
                className="px-2 py-1 rounded text-[11px] text-muted-foreground hover:bg-card">
                ×
              </button>
            </div>
          )}

          {/* Lista de subpastas */}
          <div className="rounded-lg border max-h-60 overflow-y-auto">
            {folders.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">
                {currentFolderId ? 'Sem subpastas — vai mover pra esta pasta' : 'Sem pastas — vai mover pra raiz'}
              </p>
            ) : (
              folders.map(f => {
                const isOwnItem = itemType === 'folder' && f.id === itemId
                return (
                  <button key={f.id}
                    onClick={() => setCurrentFolderId(f.id)}
                    disabled={isOwnItem}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b last:border-b-0',
                      isOwnItem
                        ? 'opacity-40 cursor-not-allowed bg-muted/30'
                        : 'hover:bg-accent',
                    )}
                    title={isOwnItem ? 'Não pode mover pra si mesma' : undefined}>
                    <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="flex-1 truncate font-medium">{f.name}</span>
                    {f.visibility === 'PUBLIC' && <Globe className="h-3 w-3 text-emerald-500" />}
                    {f.visibility === 'SHARED' && <Users className="h-3 w-3 text-blue-500" />}
                    {f.visibility === 'PRIVATE' && <Lock className="h-3 w-3 text-muted-foreground/60" />}
                    {!isOwnItem && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t shrink-0 bg-muted/20 rounded-b-xl">
          <p className="text-xs text-muted-foreground truncate">
            Destino: <strong className="text-foreground">{breadcrumbs.at(-1)?.name ?? 'Meus arquivos'}</strong>
            {isSelf && <span className="ml-2 text-destructive">(é a própria pasta)</span>}
            {isSameAsNow && !isSelf && <span className="ml-2 text-muted-foreground italic">(local atual)</span>}
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
            <button
              onClick={() => canMove && moveMutation.mutate()}
              disabled={!canMove}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground',
                !canMove && 'opacity-50 cursor-not-allowed',
              )}>
              <Check className="h-3.5 w-3.5" />
              Mover aqui
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
