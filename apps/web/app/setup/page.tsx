'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bot, CheckCircle2, Database, Settings2, User } from 'lucide-react'
import { getApiUrl } from '@/lib/runtime-config'

const steps = [
  { id: 1, title: 'Bem-vindo', icon: Bot },
  { id: 2, title: 'Banco de Dados', icon: Database },
  { id: 3, title: 'Administrador & Empresa', icon: User },
  { id: 4, title: 'Instalação', icon: Settings2 },
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [dbTested, setDbTested] = useState(false)

  const [formData, setFormData] = useState({
    databaseUrl: 'mysql://root:password@localhost:3306/aiwa',
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
    if (e.target.name === 'databaseUrl') setDbTested(false)
  }

  const handleTestDb = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${getApiUrl()}/setup/test-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: formData.databaseUrl })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Conexão com o banco de dados bem sucedida!')
        setDbTested(true)
      } else {
        toast.error(`Falha na conexão: ${data.error}`)
      }
    } catch {
      toast.error('Erro ao testar conexão.')
    } finally {
      setLoading(false)
    }
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
          // Force a full reload to clear states and fetch new settings
          window.location.href = '/login'
        }, 3000)
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
                Vamos configurar seu ambiente. Você precisará dos dados de acesso ao seu banco de dados MySQL e alguns minutos.
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
                <h2 className="text-xl font-bold">Banco de Dados</h2>
                <p className="text-sm text-muted-foreground">Insira a URL de conexão do seu banco de dados MySQL.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Database URL</label>
                  <input
                    type="text"
                    name="databaseUrl"
                    value={formData.databaseUrl}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm"
                    placeholder="mysql://user:pass@host:port/dbname"
                  />
                </div>
                
                <div className="flex gap-4">
                  <button
                    onClick={handleTestDb}
                    disabled={loading}
                    className="px-4 py-2 border border-primary text-primary rounded-lg font-medium hover:bg-primary/5 disabled:opacity-50"
                  >
                    {loading ? 'Testando...' : 'Testar Conexão'}
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={!dbTested}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    Próximo Passo
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
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
                <button onClick={() => setStep(2)} className="px-4 py-2 border rounded-lg font-medium hover:bg-muted">Voltar</button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!formData.adminPassword || formData.adminPassword.length < 6}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Confirmar e Continuar
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center space-y-6 animate-fade-in py-8">
              <h2 className="text-2xl font-bold">Tudo pronto!</h2>
              <p className="text-muted-foreground">
                As migrations do banco de dados serão rodadas e suas chaves secretas serão geradas automaticamente e salvas no .env da raiz.
              </p>

              {loading ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium text-primary animate-pulse">Instalando sistema e rodando migrations... Isso pode levar um minuto.</p>
                </div>
              ) : (
                <div className="flex gap-4 justify-center pt-8">
                  <button onClick={() => setStep(3)} className="px-4 py-2 border rounded-lg font-medium hover:bg-muted">Voltar e Revisar</button>
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
