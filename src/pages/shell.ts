const head = (title: string, extra = '') => `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%E2%99%9E%3C/text%3E%3C/svg%3E">
<link href="/static/style.css" rel="stylesheet">
${extra}
</head>`

const nav = (active: string) => `
<nav id="top-nav" class="top-nav">
  <a href="/" class="brand"><i class="fas fa-chess-knight"></i> DreamForge<span>· Cash 剧场</span></a>
  <div class="nav-links">
    <a href="/" class="${active === 'play' ? 'on' : ''}"><i class="fas fa-play"></i><b>剧场</b></a>
    <a href="/console" class="${active === 'console' ? 'on' : ''}"><i class="fas fa-gauge-high"></i><b>后台</b></a>
    <a href="/agents" class="${active === 'agents' ? 'on' : ''}"><i class="fas fa-robot"></i><b>7-Agent</b></a>
  </div>
</nav>`

export const playerPage = () => `${head('DreamForge · Cash 剧场 | 对弈式交互剧', '<link href="/static/player.css" rel="stylesheet">')}
<body class="player-body">
${nav('play')}
<main id="stage-wrap">
  <section id="stage" class="stage">
    <canvas id="fx-canvas"></canvas>
    <video id="clip-video" playsinline muted></video>
    <div id="stage-layer" class="stage-layer"></div>
  </section>
  <aside id="side-panel" class="side-panel"></aside>
</main>
<div id="modal-root"></div>
<script src="/static/player.js"></script>
</body></html>`

export const consolePage = () => `${head('Forge Console · 运营后台', '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>')}
<body class="console-body">
${nav('console')}
<div class="console-shell">
  <aside id="console-menu" class="console-menu"></aside>
  <main id="console-main" class="console-main"></main>
</div>
<div id="toast" class="toast"></div>
<script src="/static/console.js"></script>
</body></html>`

export const agentsPage = () => `${head('7-Agent 指挥中心 · DreamForge')}
<body class="console-body">
${nav('agents')}
<main id="agents-main" class="agents-main"></main>
<div id="toast" class="toast"></div>
<script src="/static/agents.js"></script>
</body></html>`
