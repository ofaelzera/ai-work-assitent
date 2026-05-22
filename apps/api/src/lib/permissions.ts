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
  'conversations.archive':     'Arquivar / desarquivar conversas',
  'conversations.takeover':    'Assumir conversa que outro está atendendo',
  'conversations.delete':      'Deletar conversa',

  // ── Kanban ────────────────────────────────────────────────────────────────
  'cards.create':              'Criar cards',
  'cards.edit':                'Editar qualquer card',
  'cards.delete':              'Deletar cards',
  'boards.manage':             'Criar / editar / deletar boards e colunas',

  // ── Contatos & Empresas ───────────────────────────────────────────────────
  'contacts.viewAll':          'Ver todos os contatos do workspace',
  'contacts.edit':             'Editar contatos',
  'contacts.delete':           'Deletar contatos',
  'companies.manage':          'Gerenciar empresas',

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
  'contacts.edit',
  'conversations.assign',  // pode encaminhar a própria
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
      'conversations.viewAll', 'conversations.assign', 'conversations.archive', 'conversations.takeover',
      'cards.create', 'cards.edit', 'cards.delete', 'boards.manage',
      'contacts.viewAll', 'contacts.edit', 'contacts.delete', 'companies.manage',
      'storage.viewAll',
      'admin.events', 'admin.users',
      'reports.view',
    ],
  },
  {
    name: 'Atendente',
    description: 'Atende conversas atribuídas a si; cria cards e edita contatos',
    permissions: [
      'cards.create', 'cards.edit',
      'contacts.edit',
      'conversations.assign',
    ],
  },
]

export function isValidPermission(p: string): p is PermissionKey {
  return p in PERMISSIONS
}
