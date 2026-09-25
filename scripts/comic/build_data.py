# 合并剧情树 + 媒体产物 → src/comic/data.json（Worker 内置剧本）
import json, os
D = os.path.dirname(os.path.abspath(__file__))
c = json.load(open(os.path.join(D, 'comic.json'))); m = json.load(open(os.path.join(D, 'media.json')))
root = os.path.abspath(os.path.join(D, '../..'))
for sid, seg in c['segments'].items():
    md = m.get(sid, {})
    lines = []
    for i in sorted(md.get('lines', {}), key=int):
        l = md['lines'][i]
        lines.append({'speaker': l['speaker'], 'text': l['text'], 'audio': l['audio'] if l['dur'] > 0 else None, 'dur': l['dur']})
    img = f'/static/comic/img/{sid}.webp'
    seg['lines'] = lines
    seg['image_url'] = img if os.path.exists(os.path.join(root, 'public' + img)) else None
    seg.pop('narration', None); seg.pop('dialogue', None)
json.dump(c, open(os.path.join(root, 'src/comic/data.json'), 'w'), ensure_ascii=False)
print('segments', len(c['segments']), 'with image', sum(1 for s in c['segments'].values() if s['image_url']))
