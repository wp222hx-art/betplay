# 上架中心：看板 → 展开待上架项目预检 → 截图（桌面 + 手机）
import asyncio, sys, os
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
PID = sys.argv[2] if len(sys.argv) > 2 else None
AK = os.environ.get('ADMIN_KEY', '')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp, mob in (('desk', {'width': 1280, 'height': 900}, False), ('mob', {'width': 390, 'height': 844}, True)):
            ctx = await b.new_context(viewport=vp, is_mobile=mob, device_scale_factor=2 if mob else 1)
            await ctx.add_init_script(f"localStorage.df_admin = '{AK}'")
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + '/publish'); await pg.wait_for_selector('.pb-row, .pb-live', timeout=20000)
            await pg.screenshot(path=f'/tmp/shots/pub_{name}_board.png', full_page=True)
            sel = f'[data-open="{PID}"]' if PID else '.pb-row'
            await pg.click(sel); await pg.wait_for_selector('.pf', timeout=20000); await pg.wait_for_timeout(500)
            await pg.screenshot(path=f'/tmp/shots/pub_{name}_pf.png', full_page=True)
            print(name, 'rows', len(await pg.query_selector_all('.pb-row')), 'live', len(await pg.query_selector_all('.pb-live')), 'form', bool(await pg.query_selector('.pf-form')), 'errs', errs)
            await ctx.close()
        await b.close()
asyncio.run(main())
