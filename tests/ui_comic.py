import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
async def skip(pg, until, n=60):
    for _ in range(n):
        if await pg.query_selector(until): return
        c = await pg.query_selector('.cap')
        if c:
            try: await c.click(timeout=400)
            except: pass
        await pg.wait_for_timeout(200)
    await pg.wait_for_selector(until, timeout=15000)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/comic'); await pg.wait_for_selector('#st'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='/tmp/shots/k1_cover.png')
        await pg.click('#st'); await pg.wait_for_selector('.cap'); await pg.wait_for_timeout(1800)
        await pg.screenshot(path='/tmp/shots/k2_prologue.png')
        await skip(pg, '#qc'); await pg.wait_for_timeout(900)
        await pg.click('.opt2 >> nth=0'); await pg.click('#stk button >> nth=1'); await pg.click('#go'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='/tmp/shots/k3_bet.png')
        await pg.click('#go'); await pg.wait_for_selector('.reveal-t'); await pg.wait_for_timeout(1800)
        await pg.screenshot(path='/tmp/shots/k4_reveal.png')
        await skip(pg, '.settle2'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='/tmp/shots/k5_settle.png')
        rw = await pg.query_selector('[data-rw="binary"]')
        if rw:
            await rw.click(); await pg.wait_for_selector('#qc', timeout=15000); await pg.wait_for_timeout(900)
            await pg.screenshot(path='/tmp/shots/k6_binary.png')
            print('binary opts', await pg.eval_on_selector_all('.opt2 b', 'e=>e.map(x=>x.innerText)'))
            await pg.click('#watch'); await skip(pg, '.settle2')
            rw2 = await pg.query_selector('[data-rw="plus"]')
            if rw2:
                await rw2.click(); await pg.wait_for_selector('#qc', timeout=15000); await pg.wait_for_timeout(900)
                await pg.screenshot(path='/tmp/shots/k7_plus.png')
                print('plus opts', await pg.eval_on_selector_all('.opt2 b', 'e=>e.map(x=>x.innerText)'))
                await pg.click('#watch'); await skip(pg, '.settle2')
        # 一路走到结局
        for d in range(6):
            nx = await pg.query_selector('#nx')
            if not nx: break
            await nx.click(); await pg.wait_for_timeout(700)
            if await pg.query_selector('.ending2'): break
            await pg.wait_for_selector('#qc', timeout=15000); await pg.click('#watch'); await skip(pg, '.settle2')
        await pg.wait_for_selector('.ending2', timeout=15000); await pg.wait_for_timeout(900)
        await pg.screenshot(path='/tmp/shots/k8_ending.png')
        print('ending:', await pg.inner_text('.ending2 .t'), '| errors', errs)
        await b.close()
asyncio.run(main())
