# Agent-3 · 漫剧媒体生产流水线：GPT Image 2 分镜（角色参考图锁一致性）+ edge-tts 多角色配音；可断点续跑
import json, os, subprocess, sys, concurrent.futures as cf, asyncio, hashlib
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(D, '../..'))
IMG_DIR = os.path.join(ROOT, 'public/static/comic/img'); AUD_DIR = os.path.join(ROOT, 'public/static/comic/audio')
os.makedirs(IMG_DIR, exist_ok=True); os.makedirs(AUD_DIR, exist_ok=True)
REF = 'https://www.genspark.ai/api/files/s/fW8VVeh3'
comic = json.load(open(os.path.join(D, 'comic.json')))
MEDIA_P = os.path.join(D, 'media.json')
media = json.load(open(MEDIA_P)) if os.path.exists(MEDIA_P) else {}

CHAR = {
 'Lin Xia': 'Lin Xia (woman, sharp black bob, long black trench coat, glowing blue wrist port)',
 'Chen Mo': 'Chen Mo (man, messy short black hair, stubble, grey detective overcoat, loose dark tie)',
 'Raven': 'Raven (assassin, black feather cloak, white beak half-mask, single red visor eye)',
 'Lin Xiaoyu': 'Lin Xiaoyu (young woman, yellow raincoat, ponytail, camera on neck)',
 'Gu Heng': 'Gu Heng (older man, slicked-back silver hair, white suit, gold cufflinks)'}
STYLE = ('Chinese manhua webtoon panel, same characters and art style as the reference sheet: bold ink linework, cel shading, subtle halftone, '
         'neo-noir cyberpunk rainy city "New Harbor", teal and magenta neon rim light, cinematic composition. ')

def img_prompt(seg):
    p = seg.get('image', '')
    chars = '; '.join(v for k, v in CHAR.items() if k in p)
    return STYLE + (f'Characters: {chars}. ' if chars else '') + 'Scene: ' + p + ' Vertical full-bleed single panel, no speech bubbles, no text, no letters, no watermark.'

def gen_image(sid):
    out = os.path.join(IMG_DIR, sid + '.webp')
    if os.path.exists(out): return sid, 'skip'
    seg = comic['segments'][sid]; tmp = f'/tmp/cimg_{sid}.png'
    for attempt in range(2):
        r = subprocess.run(['gsk', 'img', '-m', 'gpt-image-2', '-r', '9:16', '-s', '1k', '-i', REF, '-o', tmp, img_prompt(seg)],
                           capture_output=True, text=True, timeout=400)
        if os.path.exists(tmp) and os.path.getsize(tmp) > 10000:
            im = Image.open(tmp).convert('RGB'); w = 720; im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
            im.save(out, 'WEBP', quality=80); os.remove(tmp); return sid, 'ok'
        print('img retry', sid, r.stdout[-300:], r.stderr[-300:], file=sys.stderr)
    return sid, 'fail'

VOICE = {'旁白': ('zh-CN-YunyangNeural', '-8%', '-4Hz'), '林夏': ('zh-CN-XiaoxiaoNeural', '-4%', '-6Hz'), '陈默': ('zh-CN-YunxiNeural', '-10%', '-14Hz'),
         '渡鸦': ('zh-CN-YunjianNeural', '-18%', '-22Hz'), '林小雨': ('zh-CN-XiaoyiNeural', '+6%', '+2Hz'), '顾衡': ('zh-CN-YunyangNeural', '-14%', '-18Hz')}

async def tts(text, speaker, out):
    import edge_tts
    v, rate, pitch = VOICE.get(speaker, VOICE['旁白'])
    await edge_tts.Communicate(text, v, rate=rate, pitch=pitch).save(out)

def dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    return round(float(r.stdout.strip() or 0), 2)

async def gen_audio_all():
    sem = asyncio.Semaphore(8)
    async def one(sid, i, speaker, text):
        name = f'{sid}_{i}.mp3'; out = os.path.join(AUD_DIR, name)
        async with sem:
            if not os.path.exists(out):
                for a in range(3):
                    try: await tts(text, speaker, out); break
                    except Exception as e: print('tts retry', sid, e, file=sys.stderr); await asyncio.sleep(2)
        return sid, i, {'speaker': speaker, 'text': text, 'audio': f'/static/comic/audio/{name}', 'dur': dur(out) if os.path.exists(out) else 0}
    jobs = []
    for sid, seg in comic['segments'].items():
        lines = [('旁白', seg['narration'])] + [(d['speaker'].split('(')[0], d['text']) for d in seg.get('dialogue', [])]
        for i, (sp, tx) in enumerate(lines): jobs.append(one(sid, i, sp, tx))
    res = await asyncio.gather(*jobs)
    for sid, i, line in sorted(res, key=lambda x: (x[0], x[1])):
        media.setdefault(sid, {}).setdefault('lines', {})[str(i)] = line

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('audio', 'all'):
        asyncio.run(gen_audio_all()); json.dump(media, open(MEDIA_P, 'w'), ensure_ascii=False)
        print('audio done', sum(len(m.get('lines', {})) for m in media.values()), flush=True)
    if what in ('images', 'all'):
        # 生成顺序：序章 → 浅层节点 → 深层（让玩家最先到达的分支最先就绪 = 预判生成）
        order = comic['prologue'] + [o['id'] for n in sorted(comic['nodes'], key=lambda n: n['depth']) for o in n['options']]
        with cf.ThreadPoolExecutor(int(os.environ.get('CONC', '6'))) as ex:
            for sid, st in ex.map(gen_image, order):
                media.setdefault(sid, {})['image'] = f'/static/comic/img/{sid}.webp' if st != 'fail' else None
                json.dump(media, open(MEDIA_P, 'w'), ensure_ascii=False)
                print(sid, st, flush=True)
    print('ALL DONE', flush=True)
