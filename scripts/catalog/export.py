# 目录 → src/catalog/data.json（去掉封面提示词）
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import C, FORMATS, GENRES, AUDIENCES, RATINGS
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
items = []
for i, c in enumerate(C):
    d = {k: v for k, v in c.items() if k != 'prompt'}
    d.setdefault('cover', f'/static/covers/{c["id"]}.webp'); d.setdefault('url', None); d.setdefault('badge', None)
    d['order'] = i; items.append(d)
os.makedirs(os.path.join(ROOT, 'src/catalog'), exist_ok=True)
json.dump({'cats': FORMATS, 'genres': GENRES, 'audiences': AUDIENCES, 'ratings': RATINGS, 'items': items},
          open(os.path.join(ROOT, 'src/catalog/data.json'), 'w'), ensure_ascii=False, indent=0)
print(len(items), 'items')
