'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Palette, Image as ImageIcon, Save, Upload, X, Eye } from 'lucide-react'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { AdminSection } from '@/components/admin/AdminSection'

interface BrandingSettings {
  systemTitle: string
  companyName: string
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  secondaryColor: string
}

const DEFAULTS: BrandingSettings = {
  systemTitle: 'AI Work Assistant',
  companyName: 'Minha Empresa',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#6366f1',
  secondaryColor: '#4f46e5',
}

const MAX_LOGO_BYTES = 512 * 1024     // 512 KB — logos pequenos suficientes pra inline
const MAX_FAVICON_BYTES = 128 * 1024  // 128 KB

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function BrandingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiFetch<BrandingSettings>('/system-settings/public'),
  })

  const [form, setForm] = useState<BrandingSettings>(DEFAULTS)

  useEffect(() => {
    if (data) setForm({ ...DEFAULTS, ...data })
  }, [data])

  const save = useMutation({
    mutationFn: (payload: BrandingSettings) =>
      apiFetch<BrandingSettings>('/system-settings/', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success('Configurações de marca atualizadas!')
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      // Recarrega o layout (RSC) pra aplicar título, favicon e CSS vars
      router.refresh()
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Erro ao salvar')
    },
  })

  const handleField = <K extends keyof BrandingSettings>(key: K, value: BrandingSettings[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleFile = async (kind: 'logo' | 'favicon', file: File | undefined) => {
    if (!file) return
    const max = kind === 'logo' ? MAX_LOGO_BYTES : MAX_FAVICON_BYTES
    if (file.size > max) {
      toast.error(`Arquivo muito grande. Máx: ${Math.round(max / 1024)} KB`)
      return
    }
    try {
      const dataUrl = await fileToDataURL(file)
      handleField(kind === 'logo' ? 'logoUrl' : 'faviconUrl', dataUrl)
    } catch {
      toast.error('Erro ao ler o arquivo')
    }
  }

  return (
    <AdminPageLayout
      title="Marca & White-label"
      description="Personalize o nome, logotipo, cores e ícone do sistema. As mudanças se aplicam a todos os usuários."
      icon={Palette}
      maxWidth="4xl"
      action={
        <button
          onClick={() => save.mutate(form)}
          disabled={save.isPending || isLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
      }
    >
      {isLoading ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando...
        </div>
      ) : (
        <>
          {/* Identidade */}
          <AdminSection title="Identidade" description="Nome exibido no título do navegador, na tela de login e no cabeçalho." icon={Eye}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Título do sistema</label>
                <input
                  type="text"
                  value={form.systemTitle}
                  onChange={(e) => handleField('systemTitle', e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  placeholder="AI Work Assistant"
                />
                <p className="text-xs text-muted-foreground">Aparece no &lt;title&gt; da aba e no cabeçalho.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome da empresa</label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => handleField('companyName', e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Minha Empresa"
                />
                <p className="text-xs text-muted-foreground">Aparece no rodapé "Desenvolvido por".</p>
              </div>
            </div>
          </AdminSection>

          {/* Cores */}
          <AdminSection title="Cores do tema" description="Cores aplicadas como CSS variables em todo o app." icon={Palette}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Cor primária</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => handleField('primaryColor', e.target.value)}
                    className="h-10 w-16 cursor-pointer rounded border"
                  />
                  <input
                    type="text"
                    value={form.primaryColor}
                    onChange={(e) => handleField('primaryColor', e.target.value)}
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                    placeholder="#6366f1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cor secundária</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.secondaryColor}
                    onChange={(e) => handleField('secondaryColor', e.target.value)}
                    className="h-10 w-16 cursor-pointer rounded border"
                  />
                  <input
                    type="text"
                    value={form.secondaryColor}
                    onChange={(e) => handleField('secondaryColor', e.target.value)}
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                    placeholder="#4f46e5"
                  />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-4 rounded-lg border bg-muted/30 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  style={{ backgroundColor: form.primaryColor, color: 'white' }}
                  className="rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Botão Primário
                </button>
                <button
                  type="button"
                  style={{ backgroundColor: form.secondaryColor, color: 'white' }}
                  className="rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Botão Secundário
                </button>
                <span style={{ color: form.primaryColor }} className="text-sm font-medium">Texto primário</span>
              </div>
            </div>
          </AdminSection>

          {/* Logo */}
          <AdminSection title="Logotipo" description="Imagem exibida no cabeçalho e na tela de login (máx. 512 KB)." icon={ImageIcon}>
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="flex h-32 w-48 items-center justify-center rounded-lg border border-dashed bg-muted/30">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-xs text-muted-foreground">Sem logo</span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => handleFile('logo', e.target.files?.[0])}
                  className="hidden"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted"
                  >
                    <Upload className="h-4 w-4" /> Enviar imagem
                  </button>
                  {form.logoUrl && (
                    <button
                      type="button"
                      onClick={() => handleField('logoUrl', null)}
                      className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <X className="h-4 w-4" /> Remover
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG, SVG ou WebP. Convertido pra data URL e salvo no banco (não usa storage externo).
                </p>
              </div>
            </div>
          </AdminSection>

          {/* Favicon */}
          <AdminSection title="Favicon" description="Ícone exibido na aba do navegador (máx. 128 KB, ideal 32×32 ou 64×64)." icon={ImageIcon}>
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed bg-muted/30">
                {form.faviconUrl ? (
                  <img src={form.faviconUrl} alt="Favicon" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">Vazio</span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/png,image/x-icon,image/svg+xml,image/webp"
                  onChange={(e) => handleFile('favicon', e.target.files?.[0])}
                  className="hidden"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => faviconInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted"
                  >
                    <Upload className="h-4 w-4" /> Enviar favicon
                  </button>
                  {form.faviconUrl && (
                    <button
                      type="button"
                      onClick={() => handleField('faviconUrl', null)}
                      className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <X className="h-4 w-4" /> Remover
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, ICO, SVG ou WebP. Algumas mudanças de favicon precisam de hard refresh (Ctrl+Shift+R) pra aparecer.
                </p>
              </div>
            </div>
          </AdminSection>
        </>
      )}
    </AdminPageLayout>
  )
}
