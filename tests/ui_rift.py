# 时间裂隙 UI：进入第二幕 → 揭晓 → 点“⟲ 时间裂隙” → 播放裂隙片段 → 平行时间线抉择（手机视口）
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
FF = "() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')); if (v && v.duration) v.currentTime = v.duration - 0.2 }"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); errs = []; vids = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('request', lambda r: vids.append(r.url.split('?')[0].split('/')[-1]) if '.mp4' in r.url else None)
        await pg.goto(BASE + '/love'); await pg.wait_for_selector('#st'); await pg.tap('#st')
        async def until(sel):
            for _ in range(80):
                if await pg.query_selector(sel): return
                await pg.evaluate(FF); await pg.wait_for_timeout(400)
        await until('#qc'); await pg.tap('#watch'); await until('.settle2'); await pg.tap('#nx')
        await until('#qc'); await pg.tap('#watch'); await until('.settle2'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='/tmp/shots/r1_settle.png')
        print('modes', await pg.eval_on_selector_all('[data-rw]', 'e=>e.map(x=>x.dataset.rw)'))
        await pg.tap('[data-rw="fork"]'); await pg.wait_for_timeout(1900)
        await pg.screenshot(path='/tmp/shots/r2_fx.png')
        await pg.wait_for_timeout(2500); await pg.screenshot(path='/tmp/shots/r3_clip.png')
        await until('#qc'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='/tmp/shots/r4_newnode.png')
        print('chapter', await pg.inner_text('.c-chapter'), '| q', await pg.inner_text('.q-card .q'), '| opts', await pg.eval_on_selector_all('.opt2 b', 'e=>e.map(x=>x.innerText)'))
        await pg.tap('#watch'); await until('.settle2'); await pg.tap('#nx'); await pg.wait_for_selector('.ending2', timeout=20000); await pg.wait_for_timeout(600)
        await pg.screenshot(path='/tmp/shots/r5_end.png')
        print('ending', await pg.inner_text('.ending2 .t'), '| K_1 played', 'K_1.mp4' in vids, '| errors', errs)
        await b.close()
asyncio.run(main())
