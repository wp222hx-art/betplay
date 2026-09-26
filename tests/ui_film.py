import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 900}); errs = []; vids = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('request', lambda r: vids.append(r.url.split('/')[-1]) if '.mp4' in r.url else None)
        await pg.goto(BASE + '/film'); await pg.wait_for_selector('#st'); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='/tmp/shots/f1_cover.png')
        await pg.click('#st'); await pg.wait_for_timeout(6500)
        await pg.screenshot(path='/tmp/shots/f2_prologue.png')
        st = await pg.evaluate("() => [...document.querySelectorAll('.film-v')].map(v => ({src: v.currentSrc.split('/').pop(), t: +v.currentTime.toFixed(1), paused: v.paused, muted: v.muted, show: v.classList.contains('show')}))")
        print('video state', st)
        cap = await pg.query_selector('.cap .tx'); print('caption', cap and await cap.inner_text())
        await pg.wait_for_selector('#qc', timeout=30000); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='/tmp/shots/f3_decision.png')
        print('opts', await pg.eval_on_selector_all('.opt2 b', 'e=>e.map(x=>x.innerText)'))
        await pg.click('.opt2 >> nth=0'); await pg.click('#go'); await pg.wait_for_timeout(500); await pg.click('#go')
        await pg.wait_for_selector('.reveal-t', timeout=15000); await pg.wait_for_timeout(5000)
        await pg.screenshot(path='/tmp/shots/f4_reveal.png')
        await pg.wait_for_selector('.settle2', timeout=30000)
        await pg.screenshot(path='/tmp/shots/f5_settle.png')
        rw = await pg.query_selector('[data-rw="plus"]')
        print('rewind modes', await pg.eval_on_selector_all('[data-rw]', 'e=>e.map(x=>x.dataset.rw)'))
        print('videos requested', sorted(set(vids)), '| errors', errs)
        await b.close()
# asyncio.run(main())

async def full():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/film'); await pg.wait_for_selector('#st'); await pg.click('#st')
        async def ff():  # 快进：点字幕跳句
            for _ in range(40):
                if await pg.query_selector('#qc') or await pg.query_selector('.settle2') or await pg.query_selector('.ending2'): return
                await pg.evaluate("() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')&&!x.paused); if (v && v.duration) v.currentTime = v.duration - 0.2 }")
                await pg.wait_for_timeout(400)
        await ff(); await pg.wait_for_selector('#qc', timeout=30000)
        await pg.click('#watch'); await ff(); await pg.wait_for_selector('.settle2', timeout=30000)
        await pg.click('#nx'); await pg.wait_for_selector('#qc', timeout=15000)
        await pg.click('#watch'); await ff(); await pg.wait_for_selector('.settle2', timeout=30000)
        await pg.screenshot(path='/tmp/shots/f6_endclip.png')
        await pg.click('#nx'); await pg.wait_for_selector('.ending2', timeout=15000); await pg.wait_for_timeout(800)
        await pg.screenshot(path='/tmp/shots/f7_ending.png')
        print('ending:', await pg.inner_text('.ending2 .t'), '| total', await pg.inner_text('.ending2'), '| errors', errs)
        await b.close()
asyncio.run(full())
