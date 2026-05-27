module.exports = {
  apps: [
    {
      name: 'aiwa-api',
      script: 'pnpm',
      args: '--filter api start',
      cwd: './',
      env: {
        NODE_ENV: 'production',
        PORT: 3333
      }
    },
    {
      name: 'aiwa-web',
      script: 'pnpm',
      args: '--filter web start',
      cwd: './',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
