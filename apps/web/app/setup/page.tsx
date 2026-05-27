'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Bot, CheckCircle2, Settings2, User } from 'lucide-react'
import { getApiUrl } from '@/lib/runtime-config'

const steps = [
  { id: 1, title: 'Bem-vindo', icon: Bot },
  { id: 2, title: 'Administrador & Empresa', icon: User },
  { id: 3, title: 'Instalação', icon: Settings2 },
]

export default function SetupPage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    adminName: 'Admin',
    adminEmail: 'admin@aiwa.local',
    adminPassword: '',
    systemTitle: 'AI Work Assistant',
    companyName: 'My Company',
    primaryColor: '#6366f1',
    secondaryColor: '#4f46e5',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleInstall = async () => {
    if (!formData.adminPassword || formData.adminPassword.length < 6) {
      toast.error('Senha do administrador deve ter pelo menos 6 caracteres')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${getApiUrl()}/setup/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        setTimeout(() => {
          window.location.href = '/login'
        }, 4000)
      } else {
        toast.error(`Erro na instalação: ${data.error}`)
        setLoading(false)
      }
    } catch {
      toast.error('Erro de comunicação com o servidor.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl glass-card rounded-2xl p-8">

        {/* Header / Stepper */}
        <div className="flex items-center justify-between mb-8 relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-border -z-10" />
          {steps.map(s => {
            const Icon = s.icon
            const isActive = step === s.id
            const isDone = step > s.id
            return (
              <div key={s.id} className="flex flex-col items-center gap-2 bg-background px-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${isActive ? 'border-primary bg-primary/10 text-primary' : isDone ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground'}`}>
                  {isDone ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span className={`text-xs font-medium ${isActive || isDone ? 'text-foreground' : 'text-muted-foreground'}`}>{s.title}</span>
              </div>
            )
          })}
        </div>

        {/* Form Area */}
        <div className="min-h-[300px]">
          {step === 1 && (
            <div className="text-center space-y-4 animate-fade-in py-10">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-3xl font-bold">Bem-vindo ao AIWA Setup</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">
                Banco de dados, Redis, chaves JWT e demais credenciais já estão configurados no <code className="px-1.5 py-0.5 rounded bg-muted text-xs">.env</code>. Aqui você só cria o primeiro administrador e a marca do sistema.
              </p>
              <button
                onClick={() => setStep(2)}
                className="mt-8 px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Começar Instalação
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold">Configurações Iniciais</h2>
                <p className="text-sm text-muted-foreground">Crie sua conta de administrador e defina a marca do sistema (você poderá alterar as cores depois).</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Administrador</h3>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome</label>
                    <input type="text" name="adminName" value={formData.adminName} onChange={handleChange} className="w-full rounded-lg border px-4 py-2 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email</label>
                    <input type="email" name="adminEmail" value={formData.adminEmail} onChange={handleChange} className="w-full rounded-lg border px-4 py-2 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Senha</label>
                    <input type="password" name="adminPassword" value={formData.adminPassword} onChange={handleChange} className="w-full rounded-lg border px-4 py-2 text-sm" />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Empresa & Marca</h3>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome da Empresa</label>
                    <input type="text" name="companyName" value={formData.companyName} onChange={handleChange} className="w-full rounded-lg border px-4 py-2 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Título do Sistema</label>
                    <input type="text" name="systemTitle" value={formData.systemTitle} onChange={handleChange} className="w-full rounded-lg border px-4 py-2 text-sm" />
                  </div>
                  <div className="flex gap-4">
                    <div className="space-y-2 flex-1">
                      <label className="text-sm font-medium">Cor Primária</label>
                      <input type="color" name="primaryColor" value={formData.primaryColor} onChange={handleChange} className="w-full h-10 rounded cursor-pointer" />
                    </div>
                    <div className="space-y-2 flex-1">
                      <label className="text-sm font-medium">Cor Secundária</label>
                      <input type="color" name="secondaryColor" value={formData.secondaryColor} onChange={handleChange} className="w-full h-10 rounded cursor-pointer" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={() => setStep(1)} className="px-4 py-2 border rounded-lg font-medium hover:bg-muted">Voltar</button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!formData.adminPassword || formData.adminPassword.length < 6}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Confirmar e Continuar
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center space-y-6 animate-fade-in py-8">
              <h2 className="text-2xl font-bold">Tudo pronto!</h2>
              <p className="text-muted-foreground">
                Ao confirmar, vamos garantir que as migrations estão aplicadas e criar o usuário administrador. O servidor será reiniciado em seguida.
              </p>

              {loading ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium text-primary animate-pulse">Instalando sistema... Isso pode levar um minuto.</p>
                </div>
              ) : (
                <div className="flex gap-4 justify-center pt-8">
                  <button onClick={() => setStep(2)} className="px-4 py-2 border rounded-lg font-medium hover:bg-muted">Voltar e Revisar</button>
                  <button
                    onClick={handleInstall}
                    className="px-8 py-2 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
                  >
                    Instalar AIWA
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
