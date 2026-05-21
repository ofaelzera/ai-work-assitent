'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import {
  KeyRound, FileText, Code2, Terminal, HardDrive, Database, Paperclip,
  Shield, Plus, Search, Eye, EyeOff, Copy, Trash2, X, ChevronRight,
  FolderPlus, Folder, Check, Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type VaultType = 'password' | 'ssh' | 'ftp' | 'db' | 'api' | 'note' | 'file'

interface VaultFolder {
  id: string
  name: string
  parentId: string | null
}

interface VaultItemSummary {
  id: string
  type: VaultType
  title: string
  folderId: string | null
  tags: string[] | null
  favorite: boolean
  metadata: { url?: string; username?: string } | null
  secret: null
  createdAt: string
  updatedAt: string
}

type VaultItem = Omit<VaultItemSummary, 'secret'> & { secret: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<VaultType, React.ElementType> = {
  password: KeyRound,
  note: FileText,
  api: Code2,
  ssh: Terminal,
  ftp: HardDrive,
  db: Database,
  file: Paperclip,
}

const TYPE_LABELS: Record<VaultType, string> = {
  password: 'Senha',
  note: 'Nota',
  api: 'API',
  ssh: 'SSH',
  ftp: 'FTP',
  db: 'Banco de dados',
  file: 'Arquivo',
}

const ALL_TYPES: VaultType[] = ['password', 'note', 'api', 'ssh', 'ftp', 'db', 'file']

function TypeIcon({ type, className }: { type: VaultType; className?: string }) {
  const Icon = TYPE_ICONS[type] ?? Shield
  return <Icon className={cn('h-4 w-4', className)} />
}

function copyToClipboard(text: string, label = 'Copiado') {
  navigator.clipboard.writeText(text).then(() => toast.success(label))
}

// ─── SecretField ──────────────────────────────────────────────────────────────

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const readOnly = onChange === undefined

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative flex items-start gap-1">
        {multiline ? (
          <textarea
            rows={4}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            readOnly={readOnly}
            placeholder={placeholder}
            style={{ filter: !visible && !readOnly ? 'blur(4px)' : 'none' }}
          />
        ) : (
          <input
            type={visible ? 'text' : 'password'}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            readOnly={readOnly}
            placeholder={placeholder}
          />
        )}
        <div className="flex flex-col gap-1 pt-1">
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground"
            title={visible ? 'Ocultar' : 'Mostrar'}
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          {readOnly && value && (
            <button
              type="button"
              onClick={() => copyToClipboard(value)}
              className="p-1.5 rounded hover:bg-accent text-muted-foreground"
              title="Copiar"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  readOnly,
  copyable,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  readOnly?: boolean
  copyable?: boolean
}) {
  return (
    <div className="flex gap-1">
      <input
        type="text"
        className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
      />
      {copyable && value && (
        <button
          type="button"
          onClick={() => copyToClipboard(value)}
          className="p-2 rounded-md border hover:bg-accent text-muted-foreground"
          title="Copiar"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ─── Item Form Fields ─────────────────────────────────────────────────────────

interface FormState {
  type: VaultType
  title: string
  secret: string
  username: string
  url: string
  host: string
  notes: string
  folderId: string
}

function ItemFormFields({
  form,
  onChange,
  viewMode,
}: {
  form: FormState
  onChange: (patch: Partial<FormState>) => void
  viewMode: boolean
}) {
  const set = (key: keyof FormState) => (v: string) => onChange({ [key]: v })

  const commonTitle = (
    <Field label="Título">
      <Input value={form.title} onChange={viewMode ? undefined : set('title')} readOnly={viewMode} placeholder="Ex: GitHub" />
    </Field>
  )

  if (form.type === 'password') {
    return (
      <>
        {commonTitle}
        <Field label="Usuário / E-mail">
          <Input value={form.username} onChange={viewMode ? undefined : set('username')} readOnly={viewMode} placeholder="usuario@email.com" copyable={viewMode} />
        </Field>
        <SecretField
          label="Senha"
          value={form.secret}
          onChange={viewMode ? undefined : set('secret')}
          placeholder="••••••••"
        />
        <Field label="URL">
          <Input value={form.url} onChange={viewMode ? undefined : set('url')} readOnly={viewMode} placeholder="https://github.com" copyable={viewMode} />
        </Field>
        <Field label="Notas">
          <textarea
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.notes}
            onChange={viewMode ? undefined : (e) => onChange({ notes: e.target.value })}
            readOnly={viewMode}
            placeholder="Observações opcionais..."
          />
        </Field>
      </>
    )
  }

  if (form.type === 'note') {
    return (
      <>
        {commonTitle}
        <SecretField
          label="Conteúdo"
          value={form.secret}
          onChange={viewMode ? undefined : set('secret')}
          placeholder="Escreva sua nota aqui..."
          multiline
        />
      </>
    )
  }

  if (form.type === 'api') {
    return (
      <>
        {commonTitle}
        <SecretField
          label="Chave / Token"
          value={form.secret}
          onChange={viewMode ? undefined : set('secret')}
          placeholder="sk-..."
        />
        <Field label="URL / Endpoint">
          <Input value={form.url} onChange={viewMode ? undefined : set('url')} readOnly={viewMode} placeholder="https://api.example.com" copyable={viewMode} />
        </Field>
      </>
    )
  }

  if (form.type === 'ssh') {
    return (
      <>
        {commonTitle}
        <Field label="Host">
          <Input value={form.host} onChange={viewMode ? undefined : set('host')} readOnly={viewMode} placeholder="servidor.example.com" copyable={viewMode} />
        </Field>
        <Field label="Usuário">
          <Input value={form.username} onChange={viewMode ? undefined : set('username')} readOnly={viewMode} placeholder="root" copyable={viewMode} />
        </Field>
        <SecretField
          label="Chave Privada"
          value={form.secret}
          onChange={viewMode ? undefined : set('secret')}
          placeholder="-----BEGIN RSA PRIVATE KEY-----"
          multiline
        />
      </>
    )
  }

  // Generic for ftp, db, file
  return (
    <>
      {commonTitle}
      <SecretField
        label="Segredo"
        value={form.secret}
        onChange={viewMode ? undefined : set('secret')}
        placeholder="Valor secreto..."
      />
    </>
  )
}

// ─── Item Sheet ───────────────────────────────────────────────────────────────

function buildMetadata(form: FormState) {
  const meta: Record<string, string> = {}
  if (form.url) meta.url = form.url
  if (form.username) meta.username = form.username
  if (form.host) meta.host = form.host
  if (form.notes) meta.notes = form.notes
  return Object.keys(meta).length ? meta : undefined
}

function buildSecret(form: FormState): string {
  return form.secret
}

interface SheetProps {
  item: VaultItemSummary | null // null = new
  folders: VaultFolder[]
  onClose: () => void
}

function ItemSheet({ item, folders, onClose }: SheetProps) {
  const qc = useQueryClient()
  const isNew = item === null

  // When viewing an existing item, fetch decrypted version
  const { data: fullItem, isLoading: loadingSecret } = useQuery<VaultItem>({
    queryKey: ['vault-item', item?.id],
    queryFn: () => apiFetch<VaultItem>(`/vault/items/${item!.id}`),
    enabled: !isNew,
  })

  const [editing, setEditing] = useState(isNew)

  const [form, setForm] = useState<FormState>({
    type: item?.type ?? 'password',
    title: item?.title ?? '',
    secret: '',
    username: (item?.metadata?.username as string | undefined) ?? '',
    url: (item?.metadata?.url as string | undefined) ?? '',
    host: (item?.metadata as Record<string, string> | null)?.host ?? '',
    notes: (item?.metadata as Record<string, string> | null)?.notes ?? '',
    folderId: item?.folderId ?? '',
  })

  // Populate secret & metadata once full item loads
  const [populated, setPopulated] = useState(false)
  if (fullItem && !populated) {
    setPopulated(true)
    const meta = fullItem.metadata as Record<string, string> | null
    setForm({
      type: fullItem.type,
      title: fullItem.title,
      secret: fullItem.secret ?? '',
      username: meta?.username ?? '',
      url: meta?.url ?? '',
      host: meta?.host ?? '',
      notes: meta?.notes ?? '',
      folderId: fullItem.folderId ?? '',
    })
  }

  const patch = (p: Partial<FormState>) => setForm((prev) => ({ ...prev, ...p }))

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/vault/items', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-items'] })
      toast.success('Item criado!')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/vault/items/${item!.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-items'] })
      qc.invalidateQueries({ queryKey: ['vault-item', item!.id] })
      toast.success('Item salvo!')
      setEditing(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/vault/items/${item!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-items'] })
      toast.success('Item excluído')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    if (!form.title.trim()) return toast.error('Título obrigatório')
    const body = {
      type: form.type,
      title: form.title.trim(),
      secret: buildSecret(form),
      metadata: buildMetadata(form),
      folderId: form.folderId || undefined,
    }
    if (isNew) createMutation.mutate(body)
    else updateMutation.mutate(body)
  }

  const isPending =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="fixed inset-y-0 right-0 z-50 w-[440px] bg-card border-l shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            {!isNew && <TypeIcon type={form.type} className="text-muted-foreground" />}
            <h2 className="font-semibold text-sm">
              {isNew ? 'Novo item' : (editing ? 'Editar item' : form.title)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {(isNew || editing) && (
            <Field label="Tipo">
              <div className="grid grid-cols-4 gap-1.5">
                {ALL_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => patch({ type: t })}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors',
                      form.type === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-accent text-muted-foreground',
                    )}
                  >
                    <TypeIcon type={t} />
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {loadingSecret && !isNew ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Carregando segredo...
            </div>
          ) : (
            <ItemFormFields
              form={form}
              onChange={patch}
              viewMode={!editing}
            />
          )}

          {(isNew || editing) && folders.length > 0 && (
            <Field label="Pasta">
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.folderId}
                onChange={(e) => patch({ folderId: e.target.value })}
              >
                <option value="">Nenhuma pasta</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-between gap-2">
          {!isNew && !editing && (
            <>
              <button
                onClick={() => {
                  if (confirm('Excluir este item?')) deleteMutation.mutate()
                }}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </button>
              <button
                onClick={() => setEditing(true)}
                disabled={isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Editar
              </button>
            </>
          )}

          {editing && (
            <>
              <button
                onClick={() => (isNew ? onClose() : setEditing(false))}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {isPending ? 'Salvando...' : 'Salvar'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Folder Sidebar ───────────────────────────────────────────────────────────

function FolderSidebar({
  folders,
  selectedFolderId,
  onSelect,
  onAddFolder,
  onDeleteFolder,
}: {
  folders: VaultFolder[]
  selectedFolderId: string | null
  onSelect: (id: string | null) => void
  onAddFolder: (name: string) => void
  onDeleteFolder: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const handleAdd = () => {
    if (!newName.trim()) return
    onAddFolder(newName.trim())
    setNewName('')
    setAdding(false)
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r flex flex-col overflow-hidden">
      <div className="p-3 border-b flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Cofre
        </span>
        <button
          onClick={() => setAdding(true)}
          className="p-1 rounded hover:bg-accent text-muted-foreground"
          title="Nova pasta"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <button
          onClick={() => onSelect(null)}
          className={cn(
            'w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            selectedFolderId === null
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Shield className="h-4 w-4" />
          Todos os itens
        </button>

        {folders.map((folder) => (
          <div key={folder.id} className="group flex items-center">
            <button
              onClick={() => onSelect(folder.id)}
              className={cn(
                'flex-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                selectedFolderId === folder.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Folder className="h-4 w-4" />
              <span className="truncate">{folder.name}</span>
            </button>
            <button
              onClick={() => {
                if (confirm(`Excluir pasta "${folder.name}"?`)) onDeleteFolder(folder.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded hover:bg-destructive/10 text-destructive transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </nav>

      {adding && (
        <div className="p-2 border-t flex gap-1">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder="Nome da pasta"
            className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleAdd}
            className="p-1.5 rounded bg-primary text-primary-foreground"
          >
            <Check className="h-3 w-3" />
          </button>
        </div>
      )}
    </aside>
  )
}

// ─── Item Card ────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  onClick,
}: {
  item: VaultItemSummary
  onClick: () => void
}) {
  const Icon = TYPE_ICONS[item.type] ?? Shield

  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-xl border bg-card p-4 hover:shadow-md hover:border-primary/30 transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{item.title}</p>
          {item.metadata?.username && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.metadata.username}
            </p>
          )}
          {item.metadata?.url && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.metadata.url}
            </p>
          )}
          <span className="mt-2 inline-block text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            {TYPE_LABELS[item.type]}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
      </div>
    </button>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VaultPage() {
  const qc = useQueryClient()

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<VaultType | ''>('')
  const [search, setSearch] = useState('')
  const [sheetItem, setSheetItem] = useState<VaultItemSummary | 'new' | null>(null)

  // Folders
  const { data: folders = [] } = useQuery<VaultFolder[]>({
    queryKey: ['vault-folders'],
    queryFn: () => apiFetch<VaultFolder[]>('/vault/folders'),
  })

  // Items
  const params = new URLSearchParams()
  if (selectedFolderId) params.set('folderId', selectedFolderId)
  if (typeFilter) params.set('type', typeFilter)
  if (search) params.set('q', search)

  const { data: items = [], isLoading } = useQuery<VaultItemSummary[]>({
    queryKey: ['vault-items', selectedFolderId, typeFilter, search],
    queryFn: () =>
      apiFetch<VaultItemSummary[]>(`/vault/items?${params.toString()}`),
  })

  // Add folder mutation
  const addFolderMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch('/vault/folders', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault-folders'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  // Delete folder mutation
  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/vault/folders/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-folders'] })
      if (selectedFolderId !== null) setSelectedFolderId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openItem = (item: VaultItemSummary) => setSheetItem(item)
  const openNew = () => setSheetItem('new')
  const closeSheet = () => setSheetItem(null)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <FolderSidebar
        folders={folders}
        selectedFolderId={selectedFolderId}
        onSelect={setSelectedFolderId}
        onAddFolder={(name) => addFolderMutation.mutate(name)}
        onDeleteFolder={(id) => deleteFolderMutation.mutate(id)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-6 py-4 border-b flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar itens..."
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Filter className="h-4 w-4" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as VaultType | '')}
              className="rounded-md border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Todos os tipos</option>
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={openNew}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo item
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              Carregando...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground">
              <Shield className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">Nenhum item encontrado</p>
              <p className="text-xs mt-1">
                {search || typeFilter
                  ? 'Tente ajustar os filtros'
                  : 'Clique em "Novo item" para começar'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} onClick={() => openItem(item)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sheet */}
      {sheetItem !== null && (
        <ItemSheet
          item={sheetItem === 'new' ? null : sheetItem}
          folders={folders}
          onClose={closeSheet}
        />
      )}
    </div>
  )
}
