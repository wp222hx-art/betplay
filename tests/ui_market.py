# 手机端：通关得卡 → 卡册 → 卡详情 → 完整路径播放器；市场 / 制作平台 / 架构页截图
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
FF = "() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')); if (v && v.duration) v.currentTime = v.duration - 0.2 }"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, extra_http_headers={'x-forwarded-for': '77.7.7.%d' % (hash('m') % 200)})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/love'); await pg.wait_for_selector('#st'); await pg.tap('#st')
        async def until(sel):
            for _ in range(80):
                if await pg.query_selector(sel): return
                await pg.evaluate(FF); await pg.wait_for_timeout(400)
        for _ in range(3):
            await until('#qc, .ending2')
            if await pg.query_selector('.ending2'): break
            await pg.tap('#watch'); await until('.settle2'); await pg.tap('#nx')
        await pg.wait_for_selector('.mint', timeout=20000); await pg.wait_for_timeout(900)
        await pg.screenshot(path='/tmp/shots/k1_mint.png')
        print('mint:', await pg.inner_text('.mint'))
        await pg.tap('.mint'); await pg.wait_for_selector('.sheet', timeout=15000); await pg.wait_for_timeout(700)
        await pg.screenshot(path='/tmp/shots/k2_card.png')
        await pg.evaluate("document.querySelector('.sheet').scrollTop = 400"); await pg.wait_for_timeout(300); await pg.screenshot(path='/tmp/shots/k3_route.png')
        await pg.tap('[data-watch]'); await pg.wait_for_selector('.wp video'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='/tmp/shots/k4_watch.png')
        st = await pg.evaluate("(() => { const v = document.querySelector('.wp video'); return { src: v.currentSrc.split('?')[0], t: v.currentTime, bars: document.querySelectorAll('.bars i').length } })()")
        print('watch:', st)
        await pg.tap('#wpn'); await pg.wait_for_timeout(1500); print('next seg:', await pg.evaluate("document.querySelector('.wp video').currentSrc.split('?')[0]"))
        await pg.tap('#wpx'); await pg.wait_for_timeout(400)
        await pg.goto(BASE + '/market'); await pg.wait_for_timeout(1800); await pg.screenshot(path='/tmp/shots/k5_market.png')
        await pg.goto(BASE + '/market?tab=mine'); await pg.wait_for_timeout(1800); await pg.screenshot(path='/tmp/shots/k6_album.png')
        await pg.goto(BASE + '/studio'); await pg.wait_for_timeout(2200); await pg.screenshot(path='/tmp/shots/k7_studio.png')
        await pg.tap('.pj >> nth=0'); await pg.wait_for_timeout(1500); await pg.screenshot(path='/tmp/shots/k8_project.png')
        await pg.goto(BASE + '/arch'); await pg.wait_for_timeout(1200); await pg.screenshot(path='/tmp/shots/k9_arch.png')
        await pg.evaluate("document.querySelector('#a2').scrollIntoView()"); await pg.wait_for_timeout(300); await pg.screenshot(path='/tmp/shots/k10_threat.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
