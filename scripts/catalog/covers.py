# 批量生成上架封面 → public/static/covers/{id}.webp（已存在则跳过）
import os, sys, json, subprocess, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import C
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')); OUT = os.path.join(ROOT, 'public/static/covers'); os.makedirs(OUT, exist_ok=True)
def gen(c):
    f = os.path.join(OUT, c['id'] + '.webp')
    if os.path.exists(f): return c['id'], 'skip'
    png = f'/tmp/covers/{c["id"]}.png'
    for _ in range(3):
        subprocess.run(['gsk', 'img', '-m', 'nano-banana-pro', '-r', '3:4', '-o', png, c['prompt']], capture_output=True, text=True, timeout=400)
        if os.path.exists(png):
            im = Image.open(png).convert('RGB'); im.thumbnail((600, 800), Image.LANCZOS); im.save(f, 'WEBP', quality=82)
            return c['id'], 'ok'
    return c['id'], 'FAIL'
ids = sys.argv[1:]
todo = [c for c in C if 'prompt' in c and (not ids or c['id'] in ids)]
with cf.ThreadPoolExecutor(int(os.environ.get('CONC', 6))) as ex:
    for r in ex.map(gen, todo): print(*r, flush=True)
