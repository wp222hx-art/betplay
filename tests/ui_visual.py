# 视觉回归：生成剧 封面 / 抉择 / 结算 / 结局，桌面 1024 + 手机 390，检查元素溢出与图片尺寸
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
FF = "() => { const v=[...document.querySelectorAll('.film-v')].find(x=>x.classList.contains('show')); if (v && v.duration) v.currentTime = v.duration - 0.2 }"
CHECK = """() => { const bad=[]; const st=document.querySelector('#comic-stage')?.getBoundingClientRect();
  document.querySelectorAll('#comic-stage img').forEach(i=>{const r=i.getBoundingClientRect(); if(r.width>200||r.height>200) bad.push('bigimg '+i.src.split('/').slice(-2).join('/')+' '+Math.round(r.width)+'x'+Math.round(r.height))});
  document.querySelectorAll('.cover, .q-card, .settle2, .ending2').forEach(e=>{const r=e.getBoundingClientRect(); if(st && (r.right>st.right+2||r.left<st.left-2)) bad.push('overflow '+e.className)});
  return {bad, scrollW: document.documentElement.scrollWidth, vw: innerWidth} }"""
async def run(p, sid, vp, tag, ip):
    b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    mob = vp[0] < 500
    ctx = await b.new_context(viewport={'width': vp[0], 'height': vp[1]}, is_mobile=mob, has_touch=mob, extra_http_headers={'x-forwarded-for': ip})
    pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    tap = pg.tap if mob else pg.click
    await pg.goto(f'{BASE}/s/{sid}'); await pg.wait_for_selector('#st'); await pg.wait_for_timeout(1200)
    await pg.screenshot(path=f'/tmp/shots/v_{tag}_cover.png'); res = {'cover': await pg.evaluate(CHECK)}
    await tap('#st'); got = set()
    for _ in range(320):
        s = await pg.evaluate("()=>({qc:!!document.querySelector('#qc .opt2'),placed:!!document.querySelector('#go.placed'),settle:!!document.querySelector('.settle2'),end:!!document.querySelector('.ending2')})")
        if s['end']: break
        if s['qc'] and not s['placed'] and 'q' not in got:
            await pg.wait_for_timeout(600); await pg.screenshot(path=f'/tmp/shots/v_{tag}_q.png'); res['q'] = await pg.evaluate(CHECK); got.add('q')
        if s['qc'] and not s['placed'] and not s['settle']:
            await tap('.opt2 >> nth=0'); await pg.wait_for_selector('#go:not([disabled])', timeout=5000); await tap('#go'); await pg.wait_for_timeout(500)
            if await pg.query_selector('#go.placed'): await tap('#go')
        elif s['settle']:
            if 's' not in got: await pg.wait_for_timeout(400); await pg.screenshot(path=f'/tmp/shots/v_{tag}_s.png'); res['s'] = await pg.evaluate(CHECK); got.add('s')
            await tap('#nx')
        await pg.evaluate(FF); await pg.wait_for_timeout(400)
    for _ in range(100):
        if await pg.query_selector('.ending2'): break
        await pg.evaluate(FF); await pg.wait_for_timeout(400)
    await pg.wait_for_timeout(900); await pg.screenshot(path=f'/tmp/shots/v_{tag}_end.png'); res['end'] = await pg.evaluate(CHECK)
    print(tag, {k: (v['bad'], v['scrollW'] <= v['vw']) for k, v in res.items()}, 'errors', errs, flush=True)
    await b.close()
async def main():
    async with async_playwright() as p:
        n = 0
        for sid in ('gen_422d4304', 'gen_176e47ae'):
            for vp, t in (((1024, 900), 'd'), ((390, 844), 'm')):
                n += 1; await run(p, sid, vp, f'{sid[-4:]}_{t}', f'61.2.{n}.3')
asyncio.run(main())
