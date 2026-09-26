# 移动端适配审计：iPhone 14 视口，检查横向溢出 / 点击目标 / 控制台错误，并截图
import asyncio, json, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
PAGES = ['/', '/?cat=love', '/?cat=film', '/?tab=mine', '/love', '/film', '/voice', '/console', '/agents']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        rep = []
        for path in PAGES:
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + path); await pg.wait_for_timeout(2200)
            r = await pg.evaluate("""() => {
              const W = innerWidth, over = [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width && b.right > W + 1 && cs.position !== 'fixed' && !e.closest('.row,.cats,.tags,.console-menu,.hero,.shelf,[style*=overflow]') }).slice(0, 5).map(e => (e.id || e.className || e.tagName).toString().slice(0, 40))
              const small = [...document.querySelectorAll('a,button,summary,input,select')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.height && b.top < innerHeight * 3 && (b.width < 32 || b.height < 32) && getComputedStyle(e).visibility !== 'hidden' }).length
              return { scrollW: document.documentElement.scrollWidth, over, small, tabbar: !!document.querySelector('.tab-bar') && getComputedStyle(document.querySelector('.tab-bar')).display !== 'none' }
            }""")
            name = path.strip('/').replace('?', '').replace('=', '_') or 'home'
            await pg.screenshot(path=f'/tmp/shots/mob_{name}.png')
            rep.append({'page': path, **r, 'errors': errs}); await pg.close()
        for x in rep: print(json.dumps(x, ensure_ascii=False))
        await b.close()
asyncio.run(main())
