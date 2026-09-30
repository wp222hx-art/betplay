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
  }, {
    // Studio 执行节点（本沙箱）：令牌放在 .node.env（已 gitignore）
    name: 'studio-node',
    script: 'python3',
    args: 'scripts/studio/studio_node.py',
    cwd: __dirname,
    env: (() => { const e = { PYTHONUNBUFFERED: '1' }; try { for (const l of require('fs').readFileSync(__dirname + '/.node.env', 'utf8').split('\n')) { const m = l.match(/^(\w+)=(.*)$/); if (m) e[m[1]] = m[2] } } catch (x) {} return e })(),
    autorestart: true, watch: false, instances: 1, exec_mode: 'fork'
  }]
}
