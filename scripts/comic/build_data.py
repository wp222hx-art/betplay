# 合并剧情树 + 媒体 → src/comic/data.json
# V2：纯对白（dialogue.json）+ MiniMax 情感配音（voice_v2.json）+ 环境音/音效标签；V1 旁白配音作为缺失兜底
import json, os
D = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(os.path.join(D, '../..'))
c = json.load(open(os.path.join(D, 'comic.json')))
m1 = json.load(open(os.path.join(D, 'media.json')))
dlg = json.load(open(os.path.join(D, 'dialogue.json'))) if os.path.exists(os.path.join(D, 'dialogue.json')) else {}
v2 = json.load(open(os.path.join(D, 'voice_v2.json'))) if os.path.exists(os.path.join(D, 'voice_v2.json')) else {}
SFX_OK = {f[:-4] for f in os.listdir(os.path.join(root, 'public/static/comic/sfx'))} if os.path.isdir(os.path.join(root, 'public/static/comic/sfx')) else set()
stat = {'v2': 0, 'v1': 0}
for sid, seg in c['segments'].items():
    if sid in v2 and all(l.get('audio') or not l['text'].strip('…—.。 ') for l in v2[sid]):
        lines = [{'speaker': l['speaker'], 'text': l['text'], 'emotion': l.get('emotion'), 'audio': l['audio'], 'dur': l['dur']} for l in v2[sid]]
        stat['v2'] += 1
    else:
        md = m1.get(sid, {}); lines = []
        for i in sorted(md.get('lines', {}), key=int):
            l = md['lines'][i]
            if l['speaker'] == '旁白': continue  # 去旁白
            lines.append({'speaker': l['speaker'], 'text': l['text'], 'audio': l['audio'] if l['dur'] > 0 else None, 'dur': max(l['dur'], 1.2)})
        stat['v1'] += 1
    dd = dlg.get(sid, {})
    seg['lines'] = lines
    seg['ambience'] = dd.get('ambience') if dd.get('ambience') in SFX_OK else 'rain_roof'
    seg['sfx'] = dd.get('sfx') if dd.get('sfx') in SFX_OK else None
    seg['sfx_at'] = int(dd.get('sfx_at') or 0)
    img = f'/static/comic/img/{sid}.webp'; vid = f'/static/comic/video/{sid}.mp4'
    seg['image_url'] = img if os.path.exists(os.path.join(root, 'public' + img)) else None
    seg['video_url'] = vid if os.path.exists(os.path.join(root, 'public' + vid)) else None
    for k in ('narration', 'dialogue'): seg.pop(k, None)
json.dump(c, open(os.path.join(root, 'src/comic/data.json'), 'w'), ensure_ascii=False)
print('segments', len(c['segments']), stat)
