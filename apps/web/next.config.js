/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@aiwa/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@aiwa/shared', '@xyflow/react'],
  },
}

module.exports = nextConfig
