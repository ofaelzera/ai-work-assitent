'use client'

import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getAccessToken } from '@/lib/api'
import { toast } from 'sonner'
import {
  Upload, FolderOpen, X, FileText, Image as ImageIcon, Film, Music, Archive, File,
  ChevronRight, Trash2, FolderPlus, Lock, Globe, Download, Users, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'
import EditFolderModal from '@/components/EditFolderModal'
import EditFileModal from '@/components/EditFileModal'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'

interface Folder {
  id: string
  name: string
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  parentId: string | null
  ownerId: string
  createdAt: string
  _count: { files: number; children: number; shares?: number }
}

interface StorageFile {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  folderId: string | null
  uploadedBy: string
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  createdAt: string
}

interface Breadcrumb { id: string; name: string }

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-blue-500" />
  if (mimeType.startsWith('video/')) return <Film className="h-5 w-5 text-purple-500" />
  if (mimeType.startsWith('audio/')) return <Music className="h-5 w-5 text-green-500" />
  if (mimeType.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />
  if (/zip|rar|tar|gz/.test(mimeType)) return <Archive className="h-5 w-5 text-yellow-500" />
  return <File className="h-5 w-5 text-muted-foreground" />
}

// ─── New folder modal ─────────────────────────────────────────────────────
function NewFolderModal({ parentId, onClose, onCreated }: {
  parentId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE')

  const create = useMutation({
    mutationFn: () => apiFetch('/storage/folders', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), parentId, visibility }),
    }),
    onSuccess: () => { toast.success('Pasta criada'); onCreated(); onClose() },
    onError: (e: any) => toast.error(e?.message ?? 'Erro ao criar pasta'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Nova pasta</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Nome</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex: Manuais, Contratos, ..."
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Visibilidade</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setVisibility('PRIVATE')}
                className={cn('flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors',
                  visibility === 'PRIVATE' ? 'border-primary bg-primary/5' : 'hover:bg-muted/30')}>
                <Lock className="h-3.5 w-3.5 text-amber-600" />
                <div>
                  <p className="font-medium">Privada</p>
                  <p className="text-[10px] text-muted-foreground">Só você vê</p>
                </div>
              </button>
              <button
                onClick={() => setVisibility('PUBLIC')}
                className={cn('flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors',
                  visibility === 'PUBLIC' ? 'border-primary bg-primary/5' : 'hover:bg-muted/30')}>
                <Globe className="h-3.5 w-3.5 text-blue-600" />
                <div>
                  <p className="font-medium">Pública</p>
                  <p className="text-[10px] text-muted-foreground">Todos veem</p>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-accent">Cancelar</button>
          <button
            onClick={() => name.trim() && create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50">
            {create.isPending ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function StoragePage() {
  const queryClient = useQueryClient()
  const me = useAuthStore(s => s.user)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [editingFile, setEditingFile] = useState<StorageFile | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: ['storage-folders', currentFolderId],
    queryFn: () => apiFetch(`/storage/folders${currentFolderId ? `?parentId=${currentFolderId}` : ''}`),
  })

  const { data: files = [] } = useQuery<StorageFile[]>({
    queryKey: ['storage-files', currentFolderId, search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (currentFolderId) params.set('folderId', currentFolderId)
      if (search) params.set('q', search)
      return apiFetch(`/storage/files?${params}`)
    },
  })

  const { data: breadcrumbs = [] } = useQuery<Breadcrumb[]>({
    queryKey: ['storage-breadcrumb', currentFolderId],
    queryFn: () => currentFolderId
      ? apiFetch(`/storage/breadcrumb/${currentFolderId}`)
      : Promise.resolve([]),
    enabled: !!currentFolderId,
  })

  const handleUpload = useCallback(async (uploadFiles: File[]) => {
    if (!uploadFiles.length) return
    let ok = 0; let fail = 0
    for (const file of uploadFiles) {
      const fd = new FormData()
      // ATENÇÃO: campos de texto PRECISAM vir antes do `file` no FormData
      // porque o fastify-multipart só inclui em `data.fields` o que vem
      // antes do binário (ordem dos `append` importa).
      if (currentFolderId) fd.append('folderId', currentFolderId)
      fd.append('visibility', 'PRIVATE')
      fd.append('file', file)
      try {
        const r = await fetch(`${API_URL}/storage/files`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getAccessToken()}` },
          body: fd,
        })
        if (r.ok) ok++; else fail++
      } catch { fail++ }
    }
    // Força refetch imediato (await garante que rodou antes de notificar)
    await queryClient.refetchQueries({ queryKey: ['storage-files'] })
    await queryClient.refetchQueries({ queryKey: ['storage-folders'] })
    if (ok > 0) toast.success(`${ok} arquivo(s) enviado(s)`)
    if (fail > 0) toast.error(`${fail} arquivo(s) falharam`)
  }, [currentFolderId, queryClient])

  const deleteFile = useMutation({
    mutationFn: (id: string) => apiFetch(`/storage/files/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-files'] })
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] }) // _count.files muda
      toast.success('Arquivo removido')
    },
    onError: () => toast.error('Erro ao remover'),
  })

  const deleteFolder = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) =>
      apiFetch(`/storage/folders/${id}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-folders'] })
      queryClient.invalidateQueries({ queryKey: ['storage-files'] })
      toast.success('Pasta removida')
    },
  })

  const handleDownload = async (file: StorageFile) => {
    const r = await fetch(`${API_URL}/storage/attachments/${file.id}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    })
    if (!r.ok) { toast.error('Não foi possível baixar'); return }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = file.filename
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-1 text-sm flex-wrap">
          <button onClick={() => setCurrentFolderId(null)}
            className={cn('flex items-center gap-1 px-2 py-1 rounded hover:bg-accent', !currentFolderId && 'font-semibold text-primary')}>
            <FolderOpen className="h-4 w-4" /> Meus arquivos
          </button>
          {breadcrumbs.map((b, i) => (
            <div key={b.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button onClick={() => setCurrentFolderId(b.id)}
                className={cn('px-2 py-1 rounded hover:bg-accent', i === breadcrumbs.length - 1 && 'font-semibold')}>
                {b.name}
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar arquivos..."
            className="rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-44"
          />
          <button onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-accent">
            <FolderPlus className="h-3.5 w-3.5" /> Nova pasta
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium">
            <Upload className="h-3.5 w-3.5" /> Upload
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => e.target.files && handleUpload(Array.from(e.target.files))} />
        </div>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault(); setIsDragging(false)
          handleUpload(Array.from(e.dataTransfer.files))
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-6 transition-colors min-h-[60vh]',
          isDragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/10',
        )}
      >
        {folders.length === 0 && files.length === 0 ? (
          <div className="text-center py-12">
            <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {isDragging ? 'Solte os arquivos aqui' : 'Pasta vazia — arraste arquivos ou clique em Upload'}
            </p>
          </div>
        ) : (
          <>
            {folders.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pastas</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
                  {folders.map(f => {
                    const isOwner = f.ownerId === me?.sub || me?.role === 'ADMIN'
                    const VizIcon = f.visibility === 'PUBLIC' ? Globe
                      : f.visibility === 'SHARED' ? Users
                      : Lock
                    const vizColor = f.visibility === 'PUBLIC' ? 'text-emerald-500'
                      : f.visibility === 'SHARED' ? 'text-blue-500'
                      : 'text-muted-foreground'
                    const vizTitle = f.visibility === 'PUBLIC' ? 'Pública'
                      : f.visibility === 'SHARED' ? `Compartilhada${f._count.shares ? ` com ${f._count.shares} pessoa(s)` : ''}`
                      : 'Privada'
                    return (
                      <div key={f.id}
                        className="group relative rounded-lg border bg-card p-3 hover:border-primary/40 cursor-pointer transition-colors"
                        onClick={() => setCurrentFolderId(f.id)}>
                        {/* Reserva ~56px à direita pros ícones (viz + ações) — texto trunca antes */}
                        <div className="flex items-start gap-2 pr-14">
                          <FolderOpen className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{f.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {f._count.files + f._count.children > 0
                                ? `${f._count.files} arq · ${f._count.children} pastas`
                                : 'vazia'}
                            </p>
                          </div>
                        </div>

                        {/* Coluna fixa à direita: ícone de visibilidade + (no hover) ações */}
                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                          {isOwner && (
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingFolder(f) }}
                                className="p-1 rounded hover:bg-accent text-muted-foreground"
                                title="Editar pasta">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (!confirm(`Remover pasta "${f.name}"?`)) return
                                  deleteFolder.mutate({ id: f.id, cascade: false }, {
                                    onError: (err: any) => {
                                      if (err?.body?.error === 'folderNotEmpty') {
                                        if (confirm('Pasta tem conteúdo. Deletar tudo dentro?')) {
                                          deleteFolder.mutate({ id: f.id, cascade: true })
                                        }
                                      } else {
                                        toast.error('Erro ao remover pasta')
                                      }
                                    },
                                  })
                                }}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                title="Remover">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          <VizIcon className={cn('h-3 w-3 shrink-0', vizColor)} aria-label={vizTitle} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {files.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Arquivos</p>
                <div className="rounded-lg border bg-card divide-y">
                  {files.map(file => {
                    const isOwner = file.uploadedBy === me?.sub || me?.role === 'ADMIN'
                    const VizIcon = file.visibility === 'PUBLIC' ? Globe
                      : file.visibility === 'SHARED' ? Users
                      : Lock
                    const vizColor = file.visibility === 'PUBLIC' ? 'text-emerald-500'
                      : file.visibility === 'SHARED' ? 'text-blue-500'
                      : 'text-muted-foreground/60'
                    const vizTitle = file.visibility === 'PUBLIC' ? 'Público'
                      : file.visibility === 'SHARED' ? 'Compartilhado'
                      : 'Privado'
                    return (
                      <div key={file.id}
                        className="group flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors">
                        <FileIcon mimeType={file.mimeType} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.filename}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(file.sizeBytes)} · {new Date(file.createdAt).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                        <VizIcon className={cn('h-3 w-3 shrink-0', vizColor)} aria-label={vizTitle} />
                        <button onClick={() => handleDownload(file)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-accent text-muted-foreground"
                          title="Baixar">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {isOwner && (
                          <>
                            <button onClick={() => setEditingFile(file)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-accent text-muted-foreground"
                              title="Editar / Compartilhar">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => confirm(`Remover ${file.filename}?`) && deleteFile.mutate(file.id)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              title="Remover">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {showNewFolder && (
        <NewFolderModal parentId={currentFolderId}
          onClose={() => setShowNewFolder(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['storage-folders'] })} />
      )}

      {editingFolder && (
        <EditFolderModal folder={editingFolder} onClose={() => setEditingFolder(null)} />
      )}

      {editingFile && (
        <EditFileModal file={editingFile} onClose={() => setEditingFile(null)} />
      )}
    </div>
  )
}
