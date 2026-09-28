const head = (title: string, extra = '') => `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%E2%99%9E%3C/text%3E%3C/svg%3E">
<link href="/static/style.css" rel="stylesheet">
<script src="/static/auth.js"></script>
${extra}
</head>`

// 内容分类：三大形态（漫剧 / 真人剧 / 抽象剧）× 十大题材；工具页收进“工作台”
const FMT = [['anime', 'fa-wand-magic-sparkles', '漫剧'], ['live', 'fa-film', '真人剧'], ['abstract', 'fa-shapes', '抽象剧']]
const act = (a: string) => (a === 'love' ? 'anime' : a === 'film' ? 'live' : a)
const nav = (active: string) => `
<nav id="top-nav" class="top-nav">
  <a href="/" class="brand"><i class="fas fa-chess-knight"></i> DreamForge<span>· Cash 剧场</span></a>
  <div class="nav-links">
    <a href="/" class="${active === 'discover' ? 'on' : ''}"><i class="fas fa-compass"></i><b>发现</b></a>
    ${FMT.map(([k, ic, n]) => `<a href="/?cat=${k}" class="${act(active) === k ? 'on' : ''}"><i class="fas ${ic}"></i><b>${n}</b></a>`).join('')}
    <a href="/market" class="${active === 'market' ? 'on' : ''}"><i class="fas fa-gem"></i><b>结局卡</b></a>
    <details class="nav-more ${['voice', 'console', 'agents', 'studio', 'arch', 'director', 'publish'].includes(active) ? 'on' : ''}"><summary><i class="fas fa-toolbox"></i><b>工作台</b></summary>
      <div class="more-menu"><a href="/director"><i class="fas fa-video"></i> 导演台 · 一键生成</a><a href="/publish"><i class="fas fa-rocket"></i> 上架中心 · 提交上线</a><a href="/studio"><i class="fas fa-clapperboard"></i> 制作平台</a><a href="/arch"><i class="fas fa-sitemap"></i> 技术架构</a><a href="/voice"><i class="fas fa-microphone-lines"></i> 声线工作室</a><a href="/console"><i class="fas fa-gauge-high"></i> 运营后台</a><a href="/agents"><i class="fas fa-robot"></i> 7-Agent</a></div>
    </details>
  </div>
</nav>
<nav id="tab-bar" class="tab-bar">
  <a href="/" class="${active === 'discover' ? 'on' : ''}"><i class="fas fa-compass"></i><span>发现</span></a>
  ${FMT.map(([k, ic, n]) => `<a href="/?cat=${k}" class="${act(active) === k ? 'on' : ''}"><i class="fas ${ic}"></i><span>${n}</span></a>`).join('')}
  <a href="/?tab=mine" class="${active === 'mine' ? 'on' : ''}"><i class="fas fa-bookmark"></i><span>我的</span></a>
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

export const comicPage = () => `${head('穹顶之下 · 对弈式漫剧 | DreamForge', '<link href="/static/comic.css" rel="stylesheet">')}
<body class="comic-body">
${nav('comic')}
<main id="comic-wrap">
  <section id="comic-stage" class="comic-stage">
    <div id="panel-a" class="panel"></div><div id="panel-b" class="panel"></div>
    <div id="comic-layer" class="comic-layer"></div>
  </section>
  <aside id="comic-side" class="comic-side"></aside>
</main>
<div id="modal-root"></div>
<script src="/static/comic.js"></script>
</body></html>`

export const filmPage = () => `${head('穹顶之下 · 影剧版 | DreamForge', '<link href="/static/comic.css" rel="stylesheet"><link href="/static/film.css" rel="stylesheet">')}
<body class="comic-body film-body">
${nav('film')}
<main id="comic-wrap">
  <section id="comic-stage" class="comic-stage film-stage">
    <video id="film-v" class="film-v" playsinline preload="auto"></video>
    <video id="film-v2" class="film-v" playsinline preload="auto"></video>
    <div id="comic-layer" class="comic-layer"></div>
  </section>
  <aside id="comic-side" class="comic-side"></aside>
</main>
<div id="modal-root"></div>
<script>window.DF_MODE="film"</script><script src="/static/comic.js"></script>
</body></html>`

export const voicePage = () => `${head('角色声线工作室 · DreamForge', '<link href="/static/voice.css" rel="stylesheet">')}
<body class="voice-body">
${nav('voice')}
<main id="voice-main" class="voice-main">
  <header class="vh"><div><h1><i class="fas fa-microphone-lines"></i> 角色声线工作室</h1><p>为每个角色选音色、写人设和表演指令、设计专属声音；保存后批量配音就会使用这里的配置</p></div><div id="voice-status" class="vstat">检查千问服务…</div></header>
  <section id="voice-progress" class="vprog"></section>
  <section id="cast-grid" class="cast-grid"></section>
  <section id="custom-voices" class="vcard"></section>
</main>
<div id="toast" class="toast"></div>
<script src="/static/voice.js"></script>
</body></html>`

export const lovePage = () => `${head('心动回廊 ～传说之樱下的约定～ | DreamForge', '<link href="/static/comic.css" rel="stylesheet"><link href="/static/film.css" rel="stylesheet"><link href="/static/love.css" rel="stylesheet">')}
<body class="comic-body film-body love-body">
${nav('love')}
<main id="comic-wrap">
  <section id="comic-stage" class="comic-stage film-stage">
    <video id="film-v" class="film-v" playsinline preload="auto"></video>
    <video id="film-v2" class="film-v" playsinline preload="auto"></video>
    <div id="petals" class="petals"></div>
    <div id="comic-layer" class="comic-layer"></div>
  </section>
  <aside id="comic-side" class="comic-side"></aside>
</main>
<div id="modal-root"></div>
<script>window.DF_MODE="film";window.DF_API="/api/love";window.DF_THEME="love"</script><script src="/static/comic.js"></script>
</body></html>`

export const discoverPage = () => `${head('DreamForge · 对弈式互动剧 | 漫剧 · 真人剧 · 抽象剧', '<link href="/static/discover.css" rel="stylesheet">')}
<body class="discover-body">
${nav('discover')}
<main id="discover" class="discover"></main>
<div id="sheet-root"></div>
<script src="/static/discover.js"></script>
</body></html>`

export const marketPage = () => `${head('结局卡交易所 · DreamForge', '<link href="/static/market.css" rel="stylesheet">')}
<body class="market-body">
${nav('market')}
<main id="market" class="market"></main>
<div id="sheet-root"></div>
<script src="/static/market.js"></script>
</body></html>`

export const studioPage = () => `${head('制作平台 · DreamForge Studio', '<link href="/static/studio.css" rel="stylesheet">')}
<body class="studio-body">
${nav('studio')}
<main id="studio" class="studio"></main>
<script src="/static/studio.js"></script>
</body></html>`

export const archPage = () => `${head('技术架构 · DreamForge', '<link href="/static/studio.css" rel="stylesheet">')}
<body class="studio-body">
${nav('arch')}
<main id="arch" class="arch"></main>
<script src="/static/arch.js"></script>
</body></html>`

export const directorPage = () => `${head('导演台 · 主题一键生成互动剧 | DreamForge', '<link href="/static/studio.css" rel="stylesheet"><link href="/static/director.css" rel="stylesheet">')}
<body class="studio-body">
${nav('director')}
<main id="director" class="studio"></main>
<script src="/static/director.js"></script>
</body></html>`

export const publishPage = () => `${head('上架中心 · 提交上线 | DreamForge', '<link href="/static/studio.css" rel="stylesheet"><link href="/static/director.css" rel="stylesheet"><link href="/static/publish.css" rel="stylesheet">')}
<body class="studio-body">
${nav('publish')}
<main id="publish" class="studio"></main>
<script src="/static/publish.js"></script>
</body></html>`

export const seriesPage = (sid: string, title: string, cat0: string) => { const cat = cat0 === 'anime' ? 'love' : cat0; const theme = cat === 'love' ? 'love' : cat === 'abstract' ? 'abstract' : ''; return `${head(title + ' | DreamForge', '<link href="/static/comic.css" rel="stylesheet"><link href="/static/film.css" rel="stylesheet">' + (cat === 'love' ? '<link href="/static/love.css" rel="stylesheet">' : ''))}
<body class="comic-body film-body ${cat === 'love' ? 'love-body' : cat === 'abstract' ? 'abs-body' : ''}">
${nav(cat)}
<main id="comic-wrap">
  <section id="comic-stage" class="comic-stage film-stage">
    <video id="film-v" class="film-v" playsinline preload="auto"></video>
    <video id="film-v2" class="film-v" playsinline preload="auto"></video>
    ${cat === 'love' ? '<div id="petals" class="petals"></div>' : ''}
    <div id="comic-layer" class="comic-layer"></div>
  </section>
  <aside id="comic-side" class="comic-side"></aside>
</main>
<div id="modal-root"></div>
<script>window.DF_MODE="film";window.DF_API="/api/s/${sid}";window.DF_THEME="${theme}"</script><script src="/static/comic.js"></script>
</body></html>` }
