"""玩家端移动交互流体检：详情抽屉 / 真人剧开局→押注面板 / 漫剧开局→抉择押注 / 结局卡交易所。
每个状态检测横向溢出 + 关键元素是否在首屏可点（被底部 tab 栏遮挡也算失败）。截图 → /tmp/shots/flow_<宽>_<步>.png"""
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
WIDTHS = [int(x) for x in (sys.argv[2].split(',') if len(sys.argv) > 2 else ['390', '360'])]
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
CHECK = r'''(sel) => { const W = innerWidth, H = innerHeight, sw = document.documentElement.scrollWidth
  const res = { sw, ok: sw <= W + 1, el: null }
  if (sel) { const e = document.querySelector(sel); if (!e) res.el = 'missing'; else { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y)))
    res.el = (r.right <= W + 1 && r.left >= -1 && r.bottom <= H) ? (top && (e === top || e.contains(top)) ? 'tappable' : 'covered-by:' + (top ? (top.className || top.tagName).toString().slice(0, 40) : '?')) : `offscreen ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` } }
  return res }'''
fails = 0
async def snap(pg, w, name, sel=None):
    global fails
    await pg.wait_for_timeout(600)
    r = await pg.evaluate(CHECK, sel)
    bad = (not r['ok']) or (sel and r['el'] != 'tappable')
    fails += bool(bad)
    print(f"{'✗' if bad else '✓'} {w} {name:<22} sw={r['sw']} {sel or ''} {r['el'] or ''}")
    await pg.screenshot(path=f'/tmp/shots/flow_{w}_{name}.png')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in WIDTHS:
            ctx = await b.new_context(viewport={'width': w, 'height': 780 if w < 380 else 844}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
            await ctx.add_init_script("localStorage.df_adult='1';localStorage.df_voice='0';localStorage.df_bgm='0';localStorage.df_auto='0'")
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            # 1 发现页 → 详情抽屉
            await pg.goto(BASE + '/'); await pg.wait_for_timeout(1800)
            await pg.locator('.dc').first.click(); await pg.wait_for_timeout(700)
            await snap(pg, w, '1_detail_sheet', '.sheet .cta, .sheet a.btn, .sheet button')
            # 2 真人剧 天台：开局 → 押注面板
            await pg.goto(BASE + '/theater'); await pg.wait_for_timeout(1800)
            await snap(pg, w, '2_theater_lobby', '#start-btn')
            await pg.click('#start-btn'); await pg.wait_for_timeout(1500)
            for _ in range(40):
                if await pg.locator('.opt').count(): break
                await pg.wait_for_timeout(500)
                sk = pg.locator('#skip, .skip, [data-skip]')
                if await sk.count() and await sk.first.is_visible(): await sk.first.click()
            await snap(pg, w, '3_theater_bet', '.opt')
            if await pg.locator('.opt').count():
                await pg.locator('.opt').first.click(); await snap(pg, w, '4_theater_confirm', '#bet-btn, .btn-bet')
            # 3 漫剧 穹顶之下：开始 → 抉择
            await pg.goto(BASE + '/comic'); await pg.wait_for_timeout(1800)
            await snap(pg, w, '5_comic_cover', '#st')
            await pg.click('#st'); 
            for _ in range(120):
                if await pg.locator('.opt2').count(): break
                try:  # 逐句点「点击继续」（漫剧阅读器 #cap-host 点一下跳句）
                    h = pg.locator('#cap-host')
                    if await h.count(): await h.first.click(timeout=800)
                except Exception: pass
                await pg.wait_for_timeout(350)
            await snap(pg, w, '6_comic_choice', '.opt2')
            if await pg.locator('.opt2').count():
                await pg.locator('.opt2').first.click(); await snap(pg, w, '7_comic_go', '#go')
            # 4 交易所 / 导演台
            await pg.goto(BASE + '/market'); await pg.wait_for_timeout(1500); await snap(pg, w, '8_market')
            await pg.goto(BASE + '/director'); await pg.wait_for_timeout(1500); await snap(pg, w, '9_director', '#go, .go, button.primary')
            if errs: print('  JS errors:', errs[:3])
            await ctx.close()
        await b.close()
    print('FAILS', fails)
asyncio.run(main())
