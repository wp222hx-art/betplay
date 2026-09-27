# 押注窗口回归：片段正常播放（不快进）→ 面板出现后停留 N 秒再下注，必须成功；倒计时显示须从完整窗口开始
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, extra_http_headers={'x-forwarded-for': '72.3.3.3'})
        pg = await ctx.new_page(); errs = []; toasts = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.expose_function('onToast', lambda t: toasts.append(t))
        await pg.add_init_script("new MutationObserver(()=>{const t=document.querySelector('.toast.show');if(t&&t.textContent!==window.__lt){window.__lt=t.textContent;window.onToast(t.textContent)}}).observe(document,{subtree:true,childList:true,attributes:true})")
        await pg.goto(BASE + '/s/gen_422d4304'); await pg.wait_for_selector('#st'); await pg.tap('#st')
        await pg.wait_for_selector('#qc .opt2', timeout=90000)   # 序章完整播放
        await pg.wait_for_timeout(300); first = int(await pg.inner_text('#rn'))
        await pg.wait_for_timeout(9000)                          # 犹豫 9 秒
        await pg.tap('.opt2 >> nth=1'); await pg.tap('#stk [data-s="50"]'); await pg.tap('#go'); await pg.wait_for_timeout(1200)
        placed = await pg.query_selector('#go.placed') is not None
        await pg.screenshot(path='/tmp/shots/bw_placed.png')
        print('countdown starts at', first, '| bet placed after 9s:', placed, '| toasts', toasts, '| errors', errs)
        await b.close()
asyncio.run(main())
