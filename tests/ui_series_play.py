# 通用：任一上架作品从发现页进入 → 真实视频播放 → 竞猜下注 → 结算 → 结局（手机视口）；记录视频加载与报错
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
SID = sys.argv[2] if len(sys.argv) > 2 else 'gen_87c53a9f'
FF = "() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')); if (v && v.duration) v.currentTime = v.duration - 0.2 }"
ST = "()=>({qc:!!document.querySelector('#qc'),go:document.querySelector('#go')?.className,settle:!!document.querySelector('.settle2'),nx:!!document.querySelector('#nx'),end:!!document.querySelector('.ending2'),fx:!!document.querySelector('.fate-fx')})"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, extra_http_headers={'x-forwarded-for': '61.8.8.%d' % (hash(SID) % 200)})
        pg = await ctx.new_page(); errs = []; vids = set(); bad = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: (vids.add(r.url.split('?')[0].split('/')[-1]) if '/m/' in r.url and r.status in (200, 206) else None) or (bad.append((r.status, r.url[-60:])) if '/m/' in r.url and r.status >= 400 else None))
        # 发现页：概念卡已可玩
        await pg.goto(BASE + '/?cat=live'); await pg.wait_for_timeout(2500)
        card = await pg.query_selector(f'a[href="/s/{SID}"]')
        await pg.screenshot(path=f'/tmp/shots/p0_discover.png')
        await pg.goto(f'{BASE}/s/{SID}'); await pg.wait_for_selector('#st'); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='/tmp/shots/p1_cover.png')
        await pg.tap('#st'); qs = []; n = 0
        for _ in range(260):
            st = await pg.evaluate(ST)
            if st['end'] or st['fx']: break
            if st['qc'] and st['go'] == 'go' and not st['settle']:
                q = await pg.inner_text('#qc'); qs.append(q.split('\n')[0][:40])
                if n == 0: await pg.wait_for_timeout(600); await pg.screenshot(path='/tmp/shots/p2_decision.png')
                n += 1
                await pg.locator('.opt2').first.tap(); await pg.tap('#go'); await pg.wait_for_timeout(500); await pg.tap('#go')
            elif st['settle'] and st['nx']:
                if n == 1: await pg.screenshot(path='/tmp/shots/p3_settle.png')
                await pg.tap('#nx')
            elif st['nx']: await pg.tap('#nx')
            else:
                if n == 0 and _ == 6: await pg.screenshot(path='/tmp/shots/p1b_playing.png')
                await pg.evaluate(FF)
            await pg.wait_for_timeout(420)
        for _ in range(120):
            if await pg.query_selector('.ending2'): break
            await pg.evaluate(FF); await pg.wait_for_timeout(420)
        await pg.wait_for_timeout(1000); await pg.screenshot(path='/tmp/shots/p4_end.png')
        end = await pg.inner_text('.ending2 h2') if await pg.query_selector('.ending2 h2') else None
        print('discover_card', bool(card), '| decisions', n, qs, '| videos', sorted(vids), '| bad', bad[:3], '| ending', end, '| errs', errs[:3])
        await b.close()
asyncio.run(main())
