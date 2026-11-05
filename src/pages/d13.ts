// 致命13 · 社交房间独立站（不挂 MoMocash 剧场导航）
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
export const d13Page = (code?: string) => `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>致命13 · 13 个座位，一盏灯${code ? ' · 房间 ' + esc(code) : ''}</title>
<meta name="theme-color" content="#0b0708">
<meta property="og:title" content="致命13 · 来坐一个位置，还是在外围押别人？"><meta property="og:description" content="13 人一圈，每轮多一发子弹。入座押自己能活几轮，或者在外围押别人。和朋友开一个房间一起玩。"><meta property="og:image" content="/gimg/l13_deadly13/cover_wide.webp">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@700;900&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/static/brand/momo.svg">
<link href="/static/d13.css" rel="stylesheet">
<script src="/static/auth.js"></script>
</head>
<body class="d13" data-code="${code ? esc(code) : ''}">
<header id="d13-top" class="d13-top">
  <a href="/d13" class="d13-logo" aria-label="致命13 公共厅">致命<b>13</b></a>
  <div class="d13-room-tag" id="room-tag">公共厅</div>
  <div class="d13-top-r">
    <span class="chip" id="top-online" title="最近 10 分钟在玩的人"><i class="fas fa-user-group"></i><b>0</b></span>
    <span class="chip gold" id="top-bal" title="我的筹码"><i class="fas fa-coins"></i><b>0</b></span>
    <button class="chip btn-open" id="btn-open"><i class="fas fa-door-open"></i><span>开房间</span></button>
  </div>
</header>
<main id="d13-main" class="d13-main">
  <section id="d13-stage" class="d13-stage">
    <div id="d13-still" class="d13-still"></div>
    <video id="d13-v0" class="d13-video" playsinline preload="auto"></video>
    <video id="d13-v1" class="d13-video" playsinline preload="auto"></video>
    <svg id="d13-ring" class="d13-ring" viewBox="0 0 100 100"></svg>
    <div id="d13-phase" class="d13-phase"></div>
    <div id="d13-cap" class="d13-cap"></div>
    <div id="d13-big" class="d13-big"></div>
    <canvas id="d13-fx" class="d13-fx"></canvas>
    <button id="d13-tap" class="d13-tap"><i class="fas fa-volume-high"></i><span>点一下进入现场</span></button>
  </section>
  <section id="d13-panel" class="d13-panel"></section>
  <section id="d13-seats" class="d13-seats" aria-label="13 个座位"></section>
  <section id="d13-social" class="d13-social">
    <div class="tabs"><button class="on" data-t="chat">聊天</button><button data-t="outs">外围 <b id="outs-n">0</b></button><button data-t="mine">我的</button></div>
    <div id="d13-chat" class="d13-chat tab on"></div>
    <div id="d13-outs" class="d13-outs tab"></div>
    <div id="d13-mine" class="d13-mine tab"></div>
    <form id="d13-say" class="d13-say"><input id="say-in" maxlength="60" placeholder="说点什么…" autocomplete="off"><button><i class="fas fa-paper-plane"></i></button></form>
  </section>
  <footer class="d13-foot">
    <p>结果只由开局前锁定的随机种子决定，开局公布 commit、结束公开种子，任何人可复算。下注之后谁都改不了结果——包括我们。</p>
    <p><a href="/l13">单人练习版</a> · <a href="/">更多短剧 → MoMocash剧场</a></p>
    <p>筹码为平台内虚拟积分，不可兑换现金。<span id="foot-mock">座位与外围中的「模拟」玩家用于前期填充，不参与结算。</span></p>
  </footer>
</main>
<div id="d13-modal" class="d13-modal"></div>
<script src="/static/d13.js"></script>
</body></html>`
