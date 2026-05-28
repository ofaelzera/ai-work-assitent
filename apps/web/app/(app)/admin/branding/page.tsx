'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Palette, Image as ImageIcon, Save, Upload, X, Eye, Crop } from 'lucide-react'
import { AdminPageLayout } from '@/components/admin/AdminPageLayout'
import { AdminSection } from '@/components/admin/AdminSection'
import { ImageCropModal } from '@/components/ImageCropModal'

interface BrandingSettings {
  systemTitle: string
  companyName: string
  logoUrl: string | null      // tema claro
  logoDarkUrl: string | null  // tema escuro (fallback: logoUrl)
  faviconUrl: string | null
  primaryColor: string
  secondaryColor: string
  chatBgColorLight: string
  chatBgColorDark: string
}

const DEFAULTS: BrandingSettings = {
  systemTitle: 'AI Work Assistant',
  companyName: 'Minha Empresa',
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: '#6366f1',
  secondaryColor: '#4f46e5',
  chatBgColorLight: '#efeae2',
  chatBgColorDark: '#0b141a',
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB — recortado depois pelo modal

// Altura real (CSS px) que a logo ocupa na sidebar:
const LOGO_DISPLAY_HEIGHT = 56
// Output do crop: 4:1 horizontal, 600×150 px (2x da exibição final pra retina)
const LOGO_OUTPUT_WIDTH = 600
const LOGO_ASPECT = 4

// Favicon: 128×128 (quadrado), Chrome usa 32 mas 128 fica nítido em retina
const FAVICON_OUTPUT_SIZE = 128

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
  const logoDarkInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiFetch<BrandingSettings>('/system-settings/public'),
  })

  const [form, setForm] = useState<BrandingSettings>(DEFAULTS)
  type CropKind = 'logo' | 'logoDark' | 'favicon'
  const [cropState, setCropState] = useState<{ kind: CropKind; src: string } | null>(null)

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

  const handleFile = async (kind: CropKind, file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`Arquivo muito grande. Máx: ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
      return
    }
    try {
      const dataUrl = await fileToDataURL(file)
      setCropState({ kind, src: dataUrl })
    } catch {
      toast.error('Erro ao ler o arquivo')
    }
  }

  const fieldKeyForKind = (kind: CropKind): keyof BrandingSettings =>
    kind === 'logo' ? 'logoUrl' : kind === 'logoDark' ? 'logoDarkUrl' : 'faviconUrl'

  const handleCropConfirm = (croppedDataUrl: string) => {
    if (!cropState) return
    handleField(fieldKeyForKind(cropState.kind), croppedDataUrl)
    setCropState(null)
    const labels: Record<CropKind, string> = {
      logo: 'Logo (tema claro) recortada!',
      logoDark: 'Logo (tema escuro) recortada!',
      favicon: 'Favicon recortado!',
    }
    toast.success(labels[cropState.kind])
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
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground mb-4">
              <strong>Primária</strong> é a cor principal — botões, links, focus, gráficos.{' '}
              <strong>Secundária</strong> aplica em hover/accent (menus, dropdowns, botões alternativos).
              O texto sobre cada uma é ajustado automaticamente pra contraste.
            </div>

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

          {/* Fundo do Chat */}
          <AdminSection title="Fundo do Chat" description="Cores de fundo para a área de mensagens." icon={Palette}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Fundo Claro (Light Theme)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.chatBgColorLight}
                    onChange={(e) => handleField('chatBgColorLight', e.target.value)}
                    className="h-10 w-16 cursor-pointer rounded border"
                  />
                  <input
                    type="text"
                    value={form.chatBgColorLight}
                    onChange={(e) => handleField('chatBgColorLight', e.target.value)}
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                    placeholder="#efeae2"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Fundo Escuro (Dark Theme)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.chatBgColorDark}
                    onChange={(e) => handleField('chatBgColorDark', e.target.value)}
                    className="h-10 w-16 cursor-pointer rounded border"
                  />
                  <input
                    type="text"
                    value={form.chatBgColorDark}
                    onChange={(e) => handleField('chatBgColorDark', e.target.value)}
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                    placeholder="#0b141a"
                  />
                </div>
              </div>
            </div>
          </AdminSection>

          {/* Logo */}
          <AdminSection
            title="Logotipo"
            description={`Duas versões — uma pra cada tema. Sidebar e login escolhem automaticamente.`}
            icon={ImageIcon}
          >
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs flex items-start gap-2">
                <Crop className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <div>
                  Envie uma versão pra <strong>tema claro</strong> (logo escuro sobre branco) e outra pra
                  <strong> tema escuro</strong> (logo claro sobre preto). Se só enviar a do tema claro, ela é
                  usada nos dois. Output final: {LOGO_OUTPUT_WIDTH}×{LOGO_OUTPUT_WIDTH / LOGO_ASPECT}px
                  (proporção {LOGO_ASPECT}:1).
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ─── Tema claro ─── */}
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Tema claro</p>
                  <div
                    className="flex items-center px-4 rounded-md border bg-white"
                    style={{ height: LOGO_DISPLAY_HEIGHT + 24 }}
                  >
                    {form.logoUrl ? (
                      <img
                        src={form.logoUrl}
                        alt="Logo claro"
                        style={{ height: LOGO_DISPLAY_HEIGHT, maxWidth: '100%' }}
                        className="object-contain"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem logo (usa fallback do sistema)</span>
                    )}
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={(e) => {
                      handleFile('logo', e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      <Upload className="h-3.5 w-3.5" /> Enviar e recortar
                    </button>
                    {form.logoUrl && (
                      <button
                        type="button"
                        onClick={() => handleField('logoUrl', null)}
                        className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <X className="h-3.5 w-3.5" /> Remover
                      </button>
                    )}
                  </div>
                </div>

                {/* ─── Tema escuro ─── */}
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Tema escuro</p>
                  <div
                    className="flex items-center px-4 rounded-md border"
                    style={{ height: LOGO_DISPLAY_HEIGHT + 24, backgroundColor: '#0a0a0f' }}
                  >
                    {form.logoDarkUrl ? (
                      <img
                        src={form.logoDarkUrl}
                        alt="Logo escuro"
                        style={{ height: LOGO_DISPLAY_HEIGHT, maxWidth: '100%' }}
                        className="object-contain"
                      />
                    ) : form.logoUrl ? (
                      <div className="flex items-center gap-2">
                        <img
                          src={form.logoUrl}
                          alt="Logo (fallback)"
                          style={{ height: LOGO_DISPLAY_HEIGHT, maxWidth: '100%' }}
                          className="object-contain opacity-70"
                        />
                        <span className="text-[10px] text-muted-foreground">(fallback do tema claro)</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem logo</span>
                    )}
                  </div>
                  <input
                    ref={logoDarkInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={(e) => {
                      handleFile('logoDark', e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => logoDarkInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      <Upload className="h-3.5 w-3.5" /> Enviar e recortar
                    </button>
                    {form.logoDarkUrl && (
                      <button
                        type="button"
                        onClick={() => handleField('logoDarkUrl', null)}
                        className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <X className="h-3.5 w-3.5" /> Remover
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </AdminSection>

          {/* Favicon */}
          <AdminSection
            title="Favicon"
            description="Ícone exibido na aba do navegador. Imagens não-quadradas são cortadas pelo centro."
            icon={ImageIcon}
          >
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs flex items-start gap-2">
                <Crop className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <div>
                  Ao enviar, abre o <strong>editor de recorte</strong> com área quadrada fixa.
                  Output final: {FAVICON_OUTPUT_SIZE}×{FAVICON_OUTPUT_SIZE}px.
                </div>
              </div>

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
                    onChange={(e) => {
                      handleFile('favicon', e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => faviconInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Upload className="h-4 w-4" /> Enviar e recortar favicon
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
                    Mudanças de favicon podem precisar de hard refresh (Ctrl+Shift+R) pra aparecer na aba.
                  </p>
                </div>
              </div>
            </div>
          </AdminSection>
        </>
      )}

      {/* Modal de recorte — abre quando o user faz upload de logo ou favicon */}
      {cropState && (
        <ImageCropModal
          imageSrc={cropState.src}
          aspect={cropState.kind === 'favicon' ? 1 : LOGO_ASPECT}
          outputWidth={cropState.kind === 'favicon' ? FAVICON_OUTPUT_SIZE : LOGO_OUTPUT_WIDTH}
          title={
            cropState.kind === 'logo' ? 'Ajustar logo (tema claro)'
              : cropState.kind === 'logoDark' ? 'Ajustar logo (tema escuro)'
              : 'Ajustar favicon'
          }
          previewBg={
            cropState.kind === 'logo' ? 'light'
              : cropState.kind === 'logoDark' ? 'dark'
              : 'light'
          }
          onConfirm={handleCropConfirm}
          onCancel={() => setCropState(null)}
        />
      )}
    </AdminPageLayout>
  )
}
