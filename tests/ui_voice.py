import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg = await b.new_page(viewport={'width': 1360, 'height': 1000}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/voice'); await pg.wait_for_selector('.cc'); await pg.wait_for_timeout(2500)
        print('cards', await pg.eval_on_selector_all('.cc h3', 'e=>e.map(x=>x.innerText)'), '| status', await pg.inner_text('#voice-status'))
        await pg.screenshot(path='/tmp/shots/v1.png', full_page=True)
        c = pg.locator('.cc').nth(1)
        await c.locator('[data-k=qwen_persona]').fill('35岁男性前刑警，沙哑低沉、疲惫，胸腔共鸣厚，干脆利落。')
        await c.locator('.emo').select_option(index=2)
        await c.locator('.aud').click(); await pg.wait_for_selector('.cc >> nth=1 >> .ins:not([hidden])', timeout=30000)
        print('audition', await c.locator('.ins').inner_text())
        await c.locator('.save').click(); await pg.wait_for_timeout(1200)
        print('saved tag', await pg.locator('.cc').nth(1).locator('.tag').count())
        await pg.locator('.cc').nth(1).locator('.reset').click() if False else None
        await pg.locator('.cc').nth(2).locator('.dsg').click(); await pg.wait_for_selector('.mdl'); await pg.screenshot(path='/tmp/shots/v2_design.png')
        await pg.click('#dx')
        print('errors', errs)
        await b.close()
asyncio.run(main())
