# 目录 → src/catalog/data.json（去掉封面提示词）
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog import C
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
items = []
for i, c in enumerate(C):
    d = {k: v for k, v in c.items() if k != 'prompt'}
    d.setdefault('cover', f'/static/covers/{c["id"]}.webp'); d.setdefault('url', None); d.setdefault('badge', None)
    d['order'] = i; items.append(d)
os.makedirs(os.path.join(ROOT, 'src/catalog'), exist_ok=True)
json.dump({'cats': [{'id': 'love', 'name': '恋爱', 'icon': 'fa-heart', 'desc': '心动博弈 · 每一次押注都是她的心'}, {'id': 'film', 'name': '影剧', 'icon': 'fa-film', 'desc': '电影级互动剧 · 命运由你下注'}], 'items': items},
          open(os.path.join(ROOT, 'src/catalog/data.json'), 'w'), ensure_ascii=False, indent=0)
print(len(items), 'items')
