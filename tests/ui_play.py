# E2E：真实浏览器完整对局（Agent-3 UI 验收）
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/'); await pg.wait_for_selector('#start-btn')
        await pg.screenshot(path='/tmp/shots/1_home.png')
        await pg.click('#start-btn')
        # 快进台词
        for _ in range(40):
            if await pg.query_selector('#bet-panel'): break
            s = await pg.query_selector('#sub')
            if s:
                try: await s.click(timeout=500)
                except: pass
            await pg.wait_for_timeout(250)
        await pg.wait_for_selector('#bet-panel', timeout=20000)
        await pg.wait_for_timeout(600)
        await pg.click('.opt >> nth=1'); await pg.click('#stake-row button >> nth=1')
        await pg.screenshot(path='/tmp/shots/2_bet.png')
        await pg.click('#btn-bet'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='/tmp/shots/3_placed.png')
        await pg.click('#btn-bet')  # 立即锁盘揭晓
        await pg.wait_for_selector('.outcome-banner', timeout=10000); await pg.wait_for_timeout(500)
        await pg.screenshot(path='/tmp/shots/4_reveal.png')
        for _ in range(20):
            if await pg.query_selector('.settle-card'): break
            s = await pg.query_selector('#sub')
            if s:
                try: await s.click(timeout=500)
                except: pass
            await pg.wait_for_timeout(250)
        await pg.wait_for_selector('.settle-card'); await pg.wait_for_timeout(900)
        await pg.screenshot(path='/tmp/shots/5_settle.png')
        await pg.click('#btn-verify'); await pg.wait_for_selector('.modal'); await pg.wait_for_timeout(500)
        txt = await pg.inner_text('.modal')
        await pg.screenshot(path='/tmp/shots/6_verify.png')
        print('VERIFY local ok:', '本地 HMAC 复算：✓' in txt.replace('\n',''), '| chain ok:', '未被篡改' in txt)
        await pg.click('[data-close]')
        # 悔棋
        rb = await pg.query_selector('#btn-rewind')
        if rb:
            await rb.click(); await pg.wait_for_selector('#slide')
            k = await pg.query_selector('#slide .knob'); box = await k.bounding_box(); sl = await (await pg.query_selector('#slide')).bounding_box()
            await pg.mouse.move(box['x']+10, box['y']+10); await pg.mouse.down()
            await pg.mouse.move(sl['x']+sl['width']-5, box['y']+10, steps=12); await pg.mouse.up()
            await pg.wait_for_timeout(700); await pg.screenshot(path='/tmp/shots/7_rewind.png')
            await pg.wait_for_selector('#bet-panel', timeout=15000); await pg.wait_for_timeout(400)
            await pg.screenshot(path='/tmp/shots/8_rewound_bet.png')
            print('REWIND ok; min bet text:', (await pg.inner_text('.bet-meta'))[:80])
        print('PAGE ERRORS:', errs)
        await b.close()
asyncio.run(main())
