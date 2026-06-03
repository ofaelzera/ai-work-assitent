'use client'

import { useMemo, useState, useEffect } from 'react'
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout'
import { cn } from '@/lib/utils'
import { Settings2, Check, RotateCcw, X, GripVertical, Plus } from 'lucide-react'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

export interface GridItemDef {
  key: string
  title: string
  node: React.ReactNode
  w: number
  h: number
  minW?: number
  minH?: number
}

interface Props {
  /** Todos os itens que o usuário PODE usar (admin liberou). */
  items: GridItemDef[]
  /** Chaves ocultadas pelo usuário. */
  hiddenKeys: string[]
  /** Layout salvo (por breakpoint) ou null. */
  savedLayouts: Layouts | null
  /** Persiste layout + ocultos. */
  onPersist: (p: { layouts: Layouts; hidden: string[] }) => void
  saving?: boolean
}

const COLS: Record<string, number> = { lg: 12, md: 8, sm: 4, xs: 2, xxs: 1 }
const BREAKPOINTS: Record<string, number> = { lg: 1024, md: 768, sm: 640, xs: 480, xxs: 0 }
const ROW_HEIGHT = 40

// Empacota itens em `cols` colunas (shelf packing simples).
function packLayout(items: GridItemDef[], cols: number): Layout[] {
  let x = 0, y = 0, rowH = 0
  return items.map((it) => {
    const w = Math.min(it.w, cols)
    if (x + w > cols) { x = 0; y += rowH; rowH = 0 }
    const item: Layout = { i: it.key, x, y, w, h: it.h, minW: Math.min(it.minW ?? 1, cols), minH: it.minH }
    x += w
    rowH = Math.max(rowH, it.h)
    return item
  })
}

// Garante que cada breakpoint tenha entradas para todos os itens visíveis:
// mantém posições existentes, remove o que sumiu e anexa novos no fim.
function reconcile(prev: Layouts, visible: GridItemDef[]): Layouts {
  const out: Layouts = {}
  for (const bp of Object.keys(COLS)) {
    const cols = COLS[bp]
    const existing = (prev[bp] ?? []).filter(l => visible.some(it => it.key === l.i))
    const missing = visible.filter(it => !existing.some(l => l.i === it.key))
    // novos itens vão para o fim só se já houver layout; na carga inicial mantém o y empacotado
    const packed = packLayout(missing, cols).map(l => existing.length ? { ...l, y: Infinity } : l)
    out[bp] = [...existing, ...packed]
  }
  return out
}

export function DashboardGrid({ items, hiddenKeys, savedLayouts, onPersist, saving }: Props) {
  const [editing, setEditing] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set(hiddenKeys))
  const [tray, setTray] = useState(false)

  const visibleItems = useMemo(() => items.filter(i => !hidden.has(i.key)), [items, hidden])
  // assinatura estável (chaves + tamanhos) p/ saber quando reconstruir
  const sig = useMemo(() => visibleItems.map(i => `${i.key}:${i.w}x${i.h}`).join('|'), [visibleItems])

  const [layouts, setLayouts] = useState<Layouts>(() => reconcile(savedLayouts ?? {}, visibleItems))

  // Reconcilia quando o conjunto de itens visíveis muda (adicionou/removeu/dados chegaram).
  useEffect(() => {
    setLayouts(prev => reconcile(prev, visibleItems))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // Sincroniza com hiddenKeys vindos de fora (ex.: salvou no perfil).
  useEffect(() => { setHidden(new Set(hiddenKeys)) }, [hiddenKeys.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const enterEdit = () => setEditing(true)
  const cancelEdit = () => {
    setHidden(new Set(hiddenKeys))
    setLayouts(reconcile(savedLayouts ?? {}, items.filter(i => !new Set(hiddenKeys).has(i.key))))
    setTray(false); setEditing(false)
  }
  const saveEdit = () => {
    onPersist({ layouts, hidden: Array.from(hidden) })
    setTray(false); setEditing(false)
  }
  const resetDefault = () => {
    setHidden(new Set())
    setLayouts(reconcile({}, items))
  }
  const removeWidget = (key: string) => setHidden(prev => new Set(prev).add(key))
  const addWidget = (key: string) => setHidden(prev => { const n = new Set(prev); n.delete(key); return n })

  const hiddenItems = useMemo(() => items.filter(i => hidden.has(i.key)), [items, hidden])

  return (
    <div>
      {/* Barra de personalização */}
      <div className="flex items-center justify-end gap-2 mb-4">
        {!editing ? (
          <button onClick={enterEdit} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-accent transition-colors">
            <Settings2 className="h-3.5 w-3.5" /> Personalizar
          </button>
        ) : (
          <>
            <button onClick={() => setTray(t => !t)} className={cn('flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors', tray ? 'bg-accent' : 'hover:bg-accent')}>
              <Plus className="h-3.5 w-3.5" /> Adicionar widget
            </button>
            <button onClick={resetDefault} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-accent transition-colors">
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão
            </button>
            <button onClick={cancelEdit} className="text-xs font-medium px-3 py-2 rounded-lg border hover:bg-accent transition-colors">Cancelar</button>
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              <Check className="h-3.5 w-3.5" /> {saving ? 'Salvando...' : 'Concluir'}
            </button>
          </>
        )}
      </div>

      {/* Bandeja de widgets ocultos */}
      {editing && tray && (
        <div className="mb-4 rounded-2xl border bg-card/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">Widgets disponíveis</p>
          {hiddenItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todos os widgets já estão na tela.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hiddenItems.map(it => (
                <button key={it.key} onClick={() => addWidget(it.key)} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border bg-background hover:border-primary/40 hover:bg-accent transition-colors">
                  <Plus className="h-3.5 w-3.5 text-primary" /> {it.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ResponsiveGridLayout
        className={cn('dash-grid', editing && 'dash-grid-editing')}
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".dash-drag-handle"
        compactType="vertical"
        onLayoutChange={(_current, all) => { if (editing) setLayouts(all) }}
      >
        {visibleItems.map(it => (
          <div
            key={it.key}
            className={cn(
              'group relative h-full rounded-3xl',
              editing && 'overflow-hidden ring-2 ring-primary/30 ring-offset-2 ring-offset-background',
            )}
          >
            {editing && (
              <div className="dash-drag-handle absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-3 py-1.5 bg-primary/90 text-primary-foreground cursor-move rounded-t-3xl">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold truncate">
                  <GripVertical className="h-3.5 w-3.5 shrink-0" /> {it.title}
                </span>
                <button onMouseDown={(e) => e.stopPropagation()} onClick={() => removeWidget(it.key)} className="shrink-0 rounded-md p-0.5 hover:bg-black/20 transition-colors" title="Remover da tela">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className={cn('h-full', editing && 'pointer-events-none pt-9 overflow-hidden')}>
              {it.node}
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  )
}
