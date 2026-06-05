const fs = require('fs')

const path = 'apps/web/app/(app)/layout.tsx'
let content = fs.readFileSync(path, 'utf8')

// 1. Update imports to include the new icons
const importsRegex = /import\s+\{([^}]+)\}\s+from\s+'lucide-react'/
const match = content.match(importsRegex)
if (match) {
  let imports = match[1]
  const newIcons = ['ChevronRight', 'Megaphone', 'LineChart', 'BarChart2', 'Activity', 'Workflow', 'Mails', 'PieChart']
  newIcons.forEach(icon => {
    if (!imports.includes(icon)) {
      imports += `, ${icon}`
    }
  })
  content = content.replace(importsRegex, `import {${imports}} from 'lucide-react'`)
}

// 2. Replace navItems and adminItems with navGroups
const itemsRegex = /\/\*\*[\s\S]*?const adminItems:[\s\S]*?\]/
const navGroupsCode = `/**
 * Estrutura de grupos do menu lateral.
 */
type NavItem = {
  href: string;
  label: string;
  icon: any;
  perm?: string;
  badge?: { text: string; variant: 'beta' | 'new' };
};

type NavGroup = {
  title?: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'Início', icon: LayoutDashboard },
    ]
  },
  {
    title: 'ATENDIMENTO',
    items: [
      { href: '/inbox', label: 'Conversas', icon: MessageSquare },
      { href: '/chat', label: 'Chat Interno', icon: MessageSquare },
      { href: '/calendar', label: 'Agenda', icon: Calendar },
      { href: '/tasks', label: 'Tarefas', icon: CheckSquare },
      { href: '/admin/quick-replies', label: 'Respostas Rápidas', icon: MessageSquare, perm: 'admin.settings' },
    ]
  },
  {
    title: 'CRM',
    items: [
      { href: '/kanban', label: 'Negócios', icon: Kanban },
      { href: '/contacts', label: 'Contatos', icon: Users, perm: 'contacts.view' },
      { href: '/companies', label: 'Empresas', icon: Building2, perm: 'companies.view' },
    ]
  },
  {
    title: 'AUTOMAÇÕES',
    items: [
      { href: '/admin/agents', label: 'Atendente Automático', icon: Bot, perm: 'admin.agents' },
      { href: '/admin/flows', label: 'Fluxos', icon: Workflow, perm: 'flows.manage' },
      { href: '/admin/routing-rules', label: 'Roteamento', icon: Settings, perm: 'flows.manage' },
    ]
  },
  {
    title: 'MARKETING & ANÚNCIOS',
    items: [
      { href: '/admin/campaigns', label: 'Campanhas', icon: Megaphone, perm: 'admin.settings', badge: { text: 'Beta', variant: 'beta' } },
      // Exemplo de item caso queiram links/UTMs
    ]
  },
  {
    title: 'RESULTADOS',
    items: [
      { href: '/admin/reports', label: 'Painel Geral', icon: BarChart2, perm: 'reports.view' },
      { href: '/admin/ai-logs', label: 'Logs IA', icon: Activity, perm: 'admin.agents' },
      { href: '/admin/events', label: 'Eventos', icon: Activity, perm: 'admin.events' },
    ]
  },
  {
    title: 'SISTEMA & ARQUIVOS',
    items: [
      { href: '/vault', label: 'Cofre', icon: Lock },
      { href: '/storage', label: 'Arquivos', icon: FolderOpen },
    ]
  },
  {
    title: 'AJUSTES',
    items: [
      { href: '/admin/channels', label: 'Canais', icon: Settings, perm: 'admin.channels', badge: { text: 'Novo', variant: 'new' } },
      { href: '/admin/ai-settings', label: 'Provedores de IA', icon: Settings, perm: 'admin.settings' },
      { href: '/admin/users', label: 'Usuários', icon: Users, perm: 'admin.users' },
      { href: '/admin/roles', label: 'Roles e permissões', icon: Lock, perm: 'admin.users' },
      { href: '/admin/teams', label: 'Setores', icon: Building2, perm: 'teams.manage' },
      { href: '/admin/settings', label: 'Configurações', icon: Settings, perm: 'admin.settings' },
    ]
  }
];`
content = content.replace(itemsRegex, navGroupsCode)

// 3. Replace rendering logic in aside.
// Find <nav className="..."> ... </nav>
const navRegex = /<nav className="flex-1 overflow-y-auto px-4 space-y-1\.5 py-4">[\s\S]*?<\/nav>/
const newNavCode = `<nav className="flex-1 overflow-y-auto px-3 space-y-4 py-4 custom-scrollbar">
          {navGroups.map((group, idx) => {
            const hasVisibleItems = group.items.some(it => userHasPerm(user, it.perm))
            if (!hasVisibleItems) return null;

            return (
              <CollapsibleNavGroup 
                key={idx} 
                title={group.title} 
                items={group.items} 
                pathname={pathname} 
                user={user} 
              />
            )
          })}
        </nav>`
content = content.replace(navRegex, newNavCode)

// 4. Inject CollapsibleNavGroup component before AppLayout
const componentInjection = `function CollapsibleNavGroup({ title, items, pathname, user }: { title?: string, items: NavItem[], pathname: string, user: any }) {
  const [isOpen, setIsOpen] = useState(true)
  
  return (
    <div className="flex flex-col">
      {title && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors group"
        >
          <span>{title}</span>
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform opacity-50 group-hover:opacity-100", isOpen && "rotate-90")} />
        </button>
      )}
      
      <div className={cn(
        "grid transition-all duration-200 ease-in-out",
        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="overflow-hidden">
          <div className={cn("space-y-[3px]", title ? "mt-1" : "")}>
            {items.map((item) => {
              if (!userHasPerm(user, item.perm)) return null;
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-all duration-200 relative',
                    isActive
                      ? 'bg-primary/10 text-primary dark:bg-[#2d2252]/40 dark:text-[#9F7AEA]'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <item.icon className={cn(
                    "h-[18px] w-[18px] transition-transform", 
                    isActive ? "scale-110" : "opacity-70 group-hover:opacity-100 group-hover:scale-105"
                  )} />
                  <span className="flex-1 truncate">{item.label}</span>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    {item.badge && (
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border leading-none font-semibold tracking-wide",
                        item.badge.variant === 'beta' 
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                          : "border-primary/30 bg-primary/10 text-primary dark:text-[#9F7AEA]"
                      )}>
                        {item.badge.text}
                      </span>
                    )}
                    {item.href === '/chat' && <ChatUnreadBadge />}
                    {item.href === '/inbox' && <InboxBadges />}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AppLayout`
content = content.replace('export default function AppLayout', componentInjection)

// 5. Update the sidebar background to match ZapFlow's dark theme aesthetics better.
// Find: <aside className="w-64 flex-shrink-0 bg-card/60 backdrop-blur-xl border-r flex flex-col shadow-2xl z-10">
const asideRegex = /<aside className="w-64 flex-shrink-0 bg-card\/60 backdrop-blur-xl border-r flex flex-col shadow-2xl z-10">/
content = content.replace(asideRegex, '<aside className="w-[260px] flex-shrink-0 bg-[#0A0A0B] dark:bg-[#11121C] border-r border-border/40 flex flex-col shadow-2xl z-10">')

fs.writeFileSync(path, content)
console.log('updated')
