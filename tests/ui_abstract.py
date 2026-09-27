# 抽象剧《喵总裁》UI：邀请链接进场 → 喵语翻译局 + 全民陪审 → 截梗 → 结局人格 + 梗图 + 真人剧导流（手机视口）
import asyncio, sys, json, urllib.request as U
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
SID = sys.argv[2] if len(sys.argv) > 2 else 'gen_422d4304'
FF = "() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')); if (v && v.duration) v.currentTime = v.duration - 0.2 }"
ST = "()=>({qc:!!document.querySelector('#qc'),go:document.querySelector('#go')?.className,settle:!!document.querySelector('.settle2'),nx:!!document.querySelector('#nx'),end:!!document.querySelector('.ending2'),fx:!!document.querySelector('.fate-fx'),mcap:!!document.querySelector('#mcap')})"
async def main():
    # 邀请人
    ref = json.loads(U.urlopen(U.Request(BASE + '/api/auth/device', data=b'{}', headers={'content-type': 'application/json', 'x-forwarded-for': '52.9.9.1'})).read())['uid']
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, extra_http_headers={'x-forwarded-for': '52.9.9.2'})
        pg = await ctx.new_page(); errs = []; toasts = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'{BASE}/s/{SID}?ref={ref}'); await pg.wait_for_selector('#st'); await pg.wait_for_timeout(900)
        await pg.screenshot(path='/tmp/shots/a0_cover.png')
        await pg.tap('#st'); shots = 0; capped = 0
        for _ in range(220):
            st = await pg.evaluate(ST)
            if st['end'] or st['fx']: break
            if st['qc'] and st['go'] == 'go' and not st['settle']:
                if shots == 0: await pg.wait_for_timeout(500); await pg.screenshot(path='/tmp/shots/a1_decision.png'); shots = 1
                ps = await pg.eval_on_selector_all('.opt2', 'e=>e.map(x=>parseInt(x.querySelector(".pp").innerText))')
                await pg.locator('.opt2').nth(ps.index(max(ps))).tap(); await pg.tap('#stk [data-s="MAX"]')
                await pg.tap('#go'); await pg.wait_for_timeout(500); await pg.tap('#go')
            elif st['settle'] and st['mcap'] and capped < 2:
                await pg.tap('#mcap'); capped += 1; await pg.wait_for_timeout(500)
                if capped == 1: await pg.screenshot(path='/tmp/shots/a2_settle.png')
                await pg.tap('#nx')
            elif st['nx']: await pg.tap('#nx')
            await pg.evaluate(FF); await pg.wait_for_timeout(420)
        for _ in range(140):
            if await pg.query_selector('.ending2'): break
            await pg.evaluate(FF); await pg.wait_for_timeout(420)
        await pg.wait_for_timeout(900)
        await pg.screenshot(path='/tmp/shots/a3_end.png', full_page=True)
        persona = await pg.inner_text('.persona h4') if await pg.query_selector('.persona') else None
        xs = await pg.eval_on_selector_all('.xs b', 'e=>e.map(x=>x.innerText)')
        if await pg.query_selector('#mm'):
            await pg.tap('#mm'); await pg.wait_for_selector('.meme-out', timeout=15000); await pg.wait_for_timeout(800)
            await pg.screenshot(path='/tmp/shots/a4_meme.png')
            src = await pg.get_attribute('.meme-out', 'src'); import base64
            open('/tmp/shots/a5_meme_full.png', 'wb').write(base64.b64decode(src.split(',')[1]))
            await pg.tap('[data-close]') if await pg.query_selector('[data-close]') else None
        print('persona', persona, '| cross-sell', xs, '| memes', capped, '| errors', errs)
        await b.close()
    f = json.loads(U.urlopen(BASE + '/api/admin/funnel').read())
    print('funnel', [(s['name'], s['u']) for s in f['steps']], 'K', f['k_factor'], f['referrals'])
asyncio.run(main())
