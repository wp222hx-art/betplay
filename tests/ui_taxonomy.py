# 分类体系 UI：首页三形态 → 抽象剧 → 题材筛选 → 女频 → 详情抽屉（手机视口），并检查旧链接 ?cat=love 兼容
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/'); await pg.wait_for_selector('.dc'); await pg.wait_for_timeout(800)
        print('tabs', await pg.eval_on_selector_all('.tab-bar a span', 'e=>e.map(x=>x.innerText)'))
        print('cats', await pg.eval_on_selector_all('#cat-tabs button', 'e=>e.map(x=>x.innerText.replace(/\\s+/g," "))'))
        print('shelves', await pg.eval_on_selector_all('.shelf h3', 'e=>e.map(x=>x.childNodes[1]?.textContent?.trim())'))
        await pg.screenshot(path='/tmp/shots/t1_home.png')
        await pg.tap('#cat-tabs [data-cat="abstract"]'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='/tmp/shots/t2_abstract.png')
        print('abstract genres', await pg.eval_on_selector_all('.facets .genres button', 'e=>e.map(x=>x.innerText.replace(/\\s+/g," "))'), '| shelves', await pg.eval_on_selector_all('.shelf h3', 'e=>e.map(x=>x.childNodes[1]?.textContent?.trim())'))
        await pg.tap('#cat-tabs [data-cat="live"]'); await pg.wait_for_timeout(500)
        await pg.tap('.facets [data-genre="suspense"]'); await pg.wait_for_timeout(700)
        print('live+suspense', await pg.eval_on_selector_all('#all .grid .dc h4', 'e=>e.map(x=>x.innerText)'), pg.url)
        await pg.tap('.facets [data-aud="female"]'); await pg.wait_for_timeout(600)
        await pg.tap('.facets [data-genre=""]'); await pg.wait_for_timeout(600)
        await pg.evaluate("document.querySelector('#facets').scrollIntoView()"); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/shots/t3_live_female.png')
        print('live female count', await pg.eval_on_selector_all('#all .grid .dc', 'e=>e.length'), pg.url)
        await pg.goto(BASE + '/?cat=anime'); await pg.wait_for_selector('.dc'); await pg.wait_for_timeout(600)
        await pg.locator('#all .grid .dc').first.tap(); await pg.wait_for_selector('.sheet'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='/tmp/shots/t4_sheet.png'); print('sheet tax', await pg.inner_text('.sh-tax'))
        await pg.goto(BASE + '/?cat=love'); await pg.wait_for_selector('.dc'); await pg.wait_for_timeout(400)
        print('legacy ?cat=love ->', await pg.inner_text('#cat-tabs button.on'))
        print('scrollW', await pg.evaluate('document.documentElement.scrollWidth'), '| errors', errs)
        await b.close()
asyncio.run(main())
