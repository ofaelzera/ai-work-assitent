/**
 * Catálogo central de permissões granulares (RBAC).
 *
 * Adicionar nova permissão:
 *   1. Coloca a chave aqui com descrição clara em PT-BR
 *   2. Usa `requirePerm('x.y')` ou `hasPermission(user, 'x.y')` no endpoint
 *   3. Adiciona ao set padrão de SUPERVISOR / ATENDENTE em DEFAULT_PERMISSIONS_BY_ROLE
 *
 * Naming convention: `<recurso>.<ação>` em camelCase. Ações comuns:
 *   • view (ver)
 *   • viewAll (ver de todos)
 *   • create / edit / delete (CRUD)
 *   • manage (atalho pra CRUD completo + listar)
 */
export const PERMISSIONS = {
  // ── Conversas ─────────────────────────────────────────────────────────────
  'conversations.viewAll':     'Ver todas as conversas (não só as minhas)',
  'conversations.assign':      'Encaminhar conversa pra outro atendente',
  'conversations.transferTeam':'Transferir conversa pra outro setor/time',
  'conversations.archive':     'Arquivar / desarquivar conversas',
  'conversations.takeover':    'Assumir conversa que outro está atendendo',
  'conversations.delete':      'Deletar conversa',

  // ── Times / Setores ───────────────────────────────────────────────────────
  'teams.view':                'Ver os setores e a fila do próprio setor',
  'teams.viewAll':             'Ver conversas de qualquer setor (não só dos meus)',
  'teams.manage':              'Criar / editar / deletar setores e gerenciar membros',

  // ── Flows / Regras de Roteamento ─────────────────────────────────────────
  'flows.manage':              'Criar / editar / publicar fluxos e regras de roteamento',

  // ── Kanban ────────────────────────────────────────────────────────────────
  'cards.create':              'Criar cards',
  'cards.edit':                'Editar qualquer card',
  'cards.delete':              'Deletar cards',
  'boards.manage':             'Criar / editar / deletar boards e colunas',

  // ── Contatos & Empresas ───────────────────────────────────────────────────
  'contacts.view':             'Acessar o módulo de Contatos (sem isso, o menu nem aparece)',
  'contacts.viewAll':          'Ver todos os contatos do workspace (não só os ligados a mim)',
  'contacts.viewVerified':     'Ver todos os contatos verificados (clientes), mesmo sem conversa atribuída',
  'contacts.edit':             'Editar contatos',
  'contacts.delete':           'Deletar contatos',
  'companies.view':            'Acessar o módulo de Empresas (sem isso, o menu nem aparece)',
  'companies.manage':          'Gerenciar empresas',

  // ── Tarefas ───────────────────────────────────────────────────────────────
  'tasks.viewAll':             'Ver tarefas de outros usuários (não só as minhas)',
  'tasks.manageAll':           'Editar / atribuir / deletar tarefas de qualquer usuário',

  // ── Storage ───────────────────────────────────────────────────────────────
  'storage.viewAll':           'Ver arquivos/pastas privados de outros usuários',
  'storage.delete':            'Deletar qualquer arquivo ou pasta',

  // ── Admin ─────────────────────────────────────────────────────────────────
  'admin.channels':            'Gerenciar canais (WhatsApp, Email)',
  'admin.agents':              'Gerenciar agentes de IA e prompts',
  'admin.users':               'Gerenciar usuários e roles',
  'admin.settings':            'Editar configurações globais do workspace',
  'admin.events':              'Ver logs de eventos e auditoria',

  // ── Relatórios ────────────────────────────────────────────────────────────
  'reports.view':              'Acessar relatórios e métricas',

  // ── Agenda / Calendário ─────────────────────────────────────────────────────
  'calendar.view':               'Acessar o módulo de agenda',
  'calendar.viewOthers':         'Ver a agenda de outros usuários',
  'calendar.createForOthers':    'Criar compromissos na agenda de terceiros',
  'calendar.editOthers':         'Editar / remarcar compromissos de terceiros',
  'calendar.cancelOthers':       'Cancelar compromissos de terceiros',
  'calendar.manageWorkingHours': 'Gerenciar horários de trabalho (próprios e de terceiros)',
  'calendar.manageCompanyHours': 'Gerenciar horário de funcionamento da empresa (global)',
} as const

export type PermissionKey = keyof typeof PERMISSIONS

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[]

/**
 * Permissões padrão por role base (ADMIN/MEMBER).
 * Usado quando o user NÃO tem `customRoleId` setado.
 *
 * ADMIN é "todas" (bypass total) — não precisa listar.
 * MEMBER tem o mínimo pra atender.
 */
export const DEFAULT_MEMBER_PERMISSIONS: PermissionKey[] = [
  'cards.create',
  'cards.edit',
  'contacts.view',
  'contacts.edit',
  'conversations.assign',      // pode encaminhar a própria
  'conversations.transferTeam',// pode transferir pra outro setor
  'teams.view',                // vê os setores e a fila do próprio
  'calendar.view',             // acessa a própria agenda
]

/**
 * Templates pra criar os roles do sistema no seed.
 * Cada workspace ganha esses 3 ao ser criado (isSystem=true, não removíveis).
 */
export interface SystemRoleTemplate {
  name: string
  description: string
  permissions: PermissionKey[]
}

export const SYSTEM_ROLES: SystemRoleTemplate[] = [
  {
    name: 'Admin',
    description: 'Acesso total ao workspace',
    permissions: [...ALL_PERMISSION_KEYS],
  },
  {
    name: 'Supervisor',
    description: 'Vê tudo, gerencia equipe, mas não mexe em integrações',
    permissions: [
      'conversations.viewAll', 'conversations.assign', 'conversations.transferTeam',
      'conversations.archive', 'conversations.takeover',
      'cards.create', 'cards.edit', 'cards.delete', 'boards.manage',
      'contacts.view', 'contacts.viewAll', 'contacts.edit', 'contacts.delete',
      'companies.view', 'companies.manage',
      'tasks.viewAll', 'tasks.manageAll',
      'storage.viewAll',
      'admin.events', 'admin.users',
      'teams.view', 'teams.viewAll', 'teams.manage',
      'flows.manage',
      'reports.view',
      'calendar.view', 'calendar.viewOthers', 'calendar.createForOthers',
      'calendar.editOthers', 'calendar.cancelOthers', 'calendar.manageWorkingHours',
    ],
  },
  {
    name: 'Atendente',
    description: 'Atende conversas atribuídas a si; cria cards e edita contatos',
    permissions: [
      'cards.create', 'cards.edit',
      'contacts.view', 'contacts.viewVerified', 'contacts.edit',
      'conversations.assign', 'conversations.transferTeam',
      'teams.view',
      'calendar.view',
    ],
  },
]

export function isValidPermission(p: string): p is PermissionKey {
  return p in PERMISSIONS
}
