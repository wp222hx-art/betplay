# 命运等级 UI：/s/gen_176e47ae 高额押注（MAX + 最高概率）→ 命运条 → 结局 fate-fx → 专属彩蛋 → 徽章（手机视口）
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
FF = "() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')); if (v && v.duration) v.currentTime = v.duration - 0.2 }"
ST = "()=>({qc:!!document.querySelector('#qc'),go:document.querySelector('#go')?.className,settle:!!document.querySelector('.settle2'),nx:!!document.querySelector('#nx'),end:!!document.querySelector('.ending2'),fx:!!document.querySelector('.fate-fx')})"
async def one(p, n):
    b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, extra_http_headers={'x-forwarded-for': f'34.2.{n}.9'})
    pg = await ctx.new_page(); errs = []; vids = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('request', lambda r: vids.append(r.url.split('?')[0].split('/')[-1]) if '.mp4' in r.url else None)
    await pg.goto(BASE + '/s/gen_176e47ae'); await pg.wait_for_selector('#st'); await pg.tap('#st')
    shot = False; tier = None
    for _ in range(160):
        st = await pg.evaluate(ST)
        if st['fx']:
            await pg.wait_for_timeout(900); await pg.screenshot(path=f'/tmp/shots/f2_fx.png'); tier = await pg.inner_text('.fate-fx h2')
            await pg.wait_for_timeout(3000); await pg.screenshot(path=f'/tmp/shots/f3_bonus.png'); break
        if st['end']: break
        if st['qc'] and st['go'] == 'go' and not st['settle']:
            ps = await pg.eval_on_selector_all('.opt2', 'e=>e.map(x=>parseInt(x.querySelector(".pp").innerText))')
            if not ps: await pg.wait_for_timeout(300); continue
            await pg.locator('.opt2').nth(ps.index(max(ps))).tap(); await pg.tap('#stk [data-s="MAX"]')
            if not shot: await pg.screenshot(path='/tmp/shots/f1_bar.png'); shot = True
            await pg.wait_for_selector('#go:not([disabled])', timeout=5000); await pg.tap('#go'); await pg.wait_for_timeout(700)
            if await pg.query_selector('#go.placed'): await pg.tap('#go')
        elif st['nx']: await pg.tap('#nx')
        await pg.evaluate(FF); await pg.wait_for_timeout(450)
    for _ in range(100):
        if await pg.query_selector('.ending2'): break
        await pg.evaluate(FF); await pg.wait_for_timeout(450)
    await pg.wait_for_timeout(800); await pg.screenshot(path=f'/tmp/shots/f4_end_{n}.png')
    badge = None
    for s in ('.fate-badge', '.fate-miss'):
        if await pg.query_selector(s): badge = await pg.inner_text(s)
    print(n, 'tier', tier, '| bonus clip', [v for v in vids if 'BONUS' in v], '| badge', badge, '| errors', errs, flush=True)
    await b.close(); return tier
async def main():
    async with async_playwright() as p:
        for n in range(1, 5):
            if await one(p, n): break
asyncio.run(main())
