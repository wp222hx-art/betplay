"""玩家端移动适配体检：多机型 × 全页面，检测横向溢出 / 溢出元素 / 过小点击区 / JS 错误，并截图。
用法：python3 scripts/mobile_audit.py [base] [页面,逗号分隔]   截图 → /tmp/shots/mob_<宽>_<页>.png"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
PAGES = sys.argv[2].split(',') if len(sys.argv) > 2 else ['/', '/theater', '/play/gamble', '/market', '/director', '/publish', '/comic', '/film', '/love', '/voice', '/console', '/agents', '/studio', '/arch']
DEVICES = [(390, 844, 'iPhone'), (360, 780, 'Android'), (768, 1024, 'iPad')]
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
PROBE = r'''() => { const W = innerWidth, out = [], small = [];
  for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || cs.visibility === 'hidden' || cs.display === 'none') continue;
    let p = e.parentElement, clipped = false; while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) || s.position === 'fixed') { clipped = true; break } p = p.parentElement }
    if (!clipped && r.right > W + 1) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0,2).join('.') : '')) + ' →' + Math.round(r.right));
    if (e.matches('button,a[href],input,select,[role=button]') && (r.height < 30 || r.width < 30) && r.top < innerHeight * 3) small.push((e.textContent || e.value || e.className || e.tagName).toString().trim().slice(0,14) + ` ${Math.round(r.width)}x${Math.round(r.height)}`) }
  return { sw: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 8), small: [...new Set(small)].slice(0, 8) } }'''
async def main():
    os.makedirs('/tmp/shots', exist_ok=True); rep = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w, h, dn in DEVICES:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=w < 700, has_touch=True, user_agent=UA)
            for path in PAGES:
                pg = await ctx.new_page(); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                try: await pg.goto(BASE + path, timeout=20000); await pg.wait_for_timeout(2200)
                except Exception as e: errs.append('goto ' + str(e)[:80])
                r = await pg.evaluate(PROBE); name = path.strip('/').replace('/', '_') or 'home'
                await pg.screenshot(path=f'/tmp/shots/mob_{w}_{name}.png')
                bad = r['sw'] > w + 1
                print(f"{'✗' if bad or errs else '✓'} {w:>3} {path:<14} sw={r['sw']:<5} {'溢出:' + ', '.join(r['out']) if bad else ''} {'小按钮:' + str(len(r['small'])) if r['small'] else ''} {errs if errs else ''}")
                rep[f'{w}{path}'] = {**r, 'errs': errs}
                await pg.close()
            await ctx.close()
        await b.close()
    json.dump(rep, open('/tmp/shots/mobile_audit.json', 'w'), ensure_ascii=False, indent=1)
asyncio.run(main())
