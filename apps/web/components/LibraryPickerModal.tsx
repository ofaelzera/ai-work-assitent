'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  X, FolderOpen, ChevronRight, FileText, Image as ImageIcon, Film, Music,
  Archive, File, Lock, Globe, Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Folder {
  id: string
  name: string
  visibility: 'PRIVATE' | 'PUBLIC'
  parentId: string | null
  _count: { files: number; children: number }
}

interface StorageFile {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  folderId: string | null
}

interface Breadcrumb { id: string; name: string }

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-blue-500" />
  if (mimeType.startsWith('video/')) return <Film className="h-4 w-4 text-purple-500" />
  if (mimeType.startsWith('audio/')) return <Music className="h-4 w-4 text-green-500" />
  if (mimeType.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />
  if (/zip|rar|tar|gz/.test(mimeType)) return <Archive className="h-4 w-4 text-yellow-500" />
  return <File className="h-4 w-4 text-muted-foreground" />
}

interface Props {
  conversationId: string
  onClose: () => void
  onSent?: () => void
}

export default function LibraryPickerModal({ conversationId, onClose, onSent }: Props) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedFile, setSelectedFile] = useState<StorageFile | null>(null)
  const [caption, setCaption] = useState('')

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

  const sendMutation = useMutation({
    mutationFn: () => apiFetch(`/conversations/${conversationId}/messages/from-library`, {
      method: 'POST',
      body: JSON.stringify({
        attachmentId: selectedFile!.id,
        ...(caption.trim() && { caption: caption.trim() }),
      }),
    }),
    onSuccess: () => {
      toast.success('Arquivo enviado')
      onSent?.()
      onClose()
    },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao enviar'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Anexar dos meus arquivos</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {/* Breadcrumb + busca */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b shrink-0">
          <div className="flex items-center gap-1 text-xs flex-wrap min-w-0 flex-1">
            <button onClick={() => setCurrentFolderId(null)}
              className={cn('flex items-center gap-1 px-2 py-1 rounded hover:bg-accent shrink-0',
                !currentFolderId && 'font-semibold text-primary')}>
              <FolderOpen className="h-3 w-3" /> Meus arquivos
            </button>
            {breadcrumbs.map((b, i) => (
              <div key={b.id} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <button onClick={() => setCurrentFolderId(b.id)}
                  className={cn('px-2 py-1 rounded hover:bg-accent truncate',
                    i === breadcrumbs.length - 1 && 'font-semibold')}>
                  {b.name}
                </button>
              </div>
            ))}
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="rounded-md border bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 w-32 shrink-0"
          />
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-3">
          {folders.length === 0 && files.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nada aqui ainda. Faça upload em <strong>Arquivos</strong> primeiro.
            </div>
          ) : (
            <>
              {folders.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                  {folders.map(f => (
                    <button key={f.id}
                      onClick={() => { setCurrentFolderId(f.id); setSelectedFile(null) }}
                      className="rounded-lg border bg-card p-2.5 hover:border-primary/40 text-left transition-colors">
                      <div className="flex items-start gap-2">
                        <FolderOpen className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{f.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {f._count.files} arq · {f._count.children} pastas
                          </p>
                        </div>
                        {f.visibility === 'PUBLIC'
                          ? <Globe className="h-3 w-3 text-blue-500 shrink-0" />
                          : <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {files.length > 0 && (
                <div className="rounded-lg border bg-card divide-y">
                  {files.map(file => (
                    <button key={file.id}
                      onClick={() => setSelectedFile(file)}
                      className={cn('w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/40 text-left',
                        selectedFile?.id === file.id && 'bg-primary/10 hover:bg-primary/15')}>
                      <FileIcon mimeType={file.mimeType} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{file.filename}</p>
                        <p className="text-[10px] text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
                      </div>
                      {selectedFile?.id === file.id && (
                        <span className="text-[10px] font-semibold text-primary">selecionado</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer: caption + enviar */}
        <div className="border-t shrink-0">
          {selectedFile && (
            <div className="px-4 py-2 bg-muted/30 flex items-center gap-2 text-xs">
              <FileIcon mimeType={selectedFile.mimeType} />
              <span className="truncate flex-1">{selectedFile.filename}</span>
              <button onClick={() => setSelectedFile(null)}
                className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="p-3 flex items-end gap-2">
            <input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder={selectedFile ? "Legenda (opcional)" : "Selecione um arquivo acima"}
              disabled={!selectedFile}
              className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
              onKeyDown={e => { if (e.key === 'Enter' && selectedFile && !sendMutation.isPending) sendMutation.mutate() }}
            />
            <button
              onClick={() => selectedFile && !sendMutation.isPending && sendMutation.mutate()}
              disabled={!selectedFile || sendMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              <Send className="h-3.5 w-3.5" />
              {sendMutation.isPending ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
