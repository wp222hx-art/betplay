# 品牌验收：发现页 / 播放页 / 上架中心 × 桌面 + 手机，检查 logo 加载、无旧品牌名、无 JS 报错
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
PAGES = ['/', '/s/gen_422d4304', '/publish', '/market']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); bad = 0
        for name, vp, mob in (('desk', {'width': 1280, 'height': 800}, False), ('mob', {'width': 390, 'height': 844}, True)):
            ctx = await b.new_context(viewport=vp, is_mobile=mob, device_scale_factor=2 if mob else 1)
            for path in PAGES:
                pg = await ctx.new_page(); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)))
                await pg.goto(BASE + path, wait_until='networkidle'); await pg.wait_for_timeout(1200)
                html = await pg.content()
                logo = await pg.evaluate("(() => { const i = document.querySelector('.brand img'); return i ? i.naturalWidth : 0 })()")
                old = 'DreamForge' in html
                tag = path.strip('/').replace('/', '_') or 'home'
                await pg.screenshot(path=f'/tmp/shots/brand_{name}_{tag}.png')
                ok = logo > 0 and not old and not errs; bad += not ok
                print(f"{'✅' if ok else '❌'} {name:4} {path:18} logo={logo} old_name={old} errs={errs[:2]}")
                await pg.close()
            await ctx.close()
        await b.close(); sys.exit(1 if bad else 0)
asyncio.run(main())
