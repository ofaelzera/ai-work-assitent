const fs = require('node:fs')
const path = require('node:path')

// Carrega o .env da raiz do monorepo (mesmo arquivo usado pela API),
// pra evitar duplicar config em apps/web/.env.
function loadRootEnv() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  const file = candidates.find(p => fs.existsSync(p))
  if (!file) return
  const content = fs.readFileSync(file, 'utf-8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadRootEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@aiwa/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@aiwa/shared', '@xyflow/react'],
  },
  // Reduz o nº de arquivos observados pelo watcher em dev (evita EMFILE:
  // "too many open files" no monorepo + symlinks do pnpm no macOS).
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**', '**/dist/**', '**/logs/**'],
      }
    }
    return config
  },
}

module.exports = nextConfig
