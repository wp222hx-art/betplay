module.exports = {
  apps: [{
    name: 'webapp',
    script: 'npx',
    args: 'wrangler pages dev dist --d1=webapp-production --local --ip 0.0.0.0 --port 3000',
    env: { NODE_ENV: 'development', PORT: 3000 },
    watch: false, instances: 1, exec_mode: 'fork'
  }, {
    // MoMo Studio 生产后台：独立应用，共享 D1/R2 本地状态。
    // 注意：wrangler 读取仓库根目录 .dev.vars，STUDIO_MASTER_KEY 需写在那里（已 gitignore）
    name: 'momo-studio',
    cwd: __dirname + '/studio',
    script: 'npx',
    args: 'wrangler pages dev dist --d1=webapp-production --local --persist-to ../.wrangler/state --ip 0.0.0.0 --port 3001',
    env: { NODE_ENV: 'development', PORT: 3001 },
    watch: false, instances: 1, exec_mode: 'fork'
  }]
}
