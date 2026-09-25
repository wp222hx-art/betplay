# 千问配音：Qwen3-TTS-Instruct-Flash（阿里云百炼 DashScope）
# 特色：每句都能用自然语言写“表演指令”（语气、情绪、语速、气声、停顿……），比情绪枚举细腻得多
# 前置：在 .dev.vars 或环境变量里配置 DASHSCOPE_API_KEY（在百炼控制台获取）；海外账号把 DASHSCOPE_BASE 设为 https://dashscope-intl.aliyuncs.com/api/v1
# 用法：python3 produce_voice_qwen.py [段落ID...]
#   → 生成的逐句音频写到 public/static/comic/v3/line/q_*.mp3，并输出 voice_qwen.json；
#     之后把 produce_voice_v3.py 里的 tts() 换成 qwen_tts()，就能复用连续对白轨的混音流程
import json, os, re, sys, subprocess, urllib.request
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
def env(k):
    if os.environ.get(k): return os.environ[k]
    p = os.path.join(ROOT, '.dev.vars')
    if os.path.exists(p):
        for ln in open(p):
            if ln.startswith(k + '='): return ln.split('=', 1)[1].strip().strip('"')
KEY = env('DASHSCOPE_API_KEY'); BASE = env('DASHSCOPE_BASE') or 'https://dashscope.aliyuncs.com/api/v1'
# 千问系统音色 → 角色（可在百炼控制台试听替换，也可以用声音复刻 / 声音设计得到的专属 voice）
VOICE = {'林夏': 'Serena', '陈默': 'Ethan', '渡鸦': 'Dylan', '林小雨': 'Cherry', '顾衡': 'Eric'}
PERSONA = {
 '林夏': '28岁女性，冷静克制的数据掮客，气声偏重，句尾压低；提到妹妹时声音发紧、微颤。',
 '陈默': '35岁男性前刑警，声音沙哑疲惫、胸腔共鸣厚，说话慢半拍，情绪都压在喉咙里。',
 '渡鸦': '冷酷杀手，极低沉、平直、没有起伏，像从面具后贴着耳边说话，字字咬死。',
 '林小雨': '20岁女大学生，清亮急切，语速快，带喘息，情绪外放。',
 '顾衡': '55岁财团董事长，浑厚的男中音，慢条斯理，笑里藏刀，每句尾音都带一点轻蔑的上扬。'}
EMO = {'sad': '哽咽、声音发颤', 'angry': '压着怒火、咬字加重', 'fearful': '紧张急促、呼吸不稳', 'surprised': '震惊、倒吸一口气', 'happy': '带着笑意', 'disgusted': '冷蔑、不屑', 'neutral': '克制'}
TAG = {'sighs': '先轻叹一口气', 'exhales': '先长出一口气', 'whispers': '压低声音耳语', 'laughs': '带一声冷笑', 'crying': '带哭腔', 'pauses': '中间有明显停顿', 'desperately': '近乎绝望', 'nervously': '紧张', 'deadpan': '毫无情绪', 'sarcastic': '讥讽', 'alarmed': '惊慌', 'frustrated': '烦躁', 'gulps': '先吞一口口水'}

def instruction(sp, emotion, raw_text):
    tags = [TAG[t] for t in re.findall(r'\[(\w+)\]', raw_text) if t in TAG]
    return f"角色：{PERSONA.get(sp, '')} 这句：{EMO.get(emotion, '克制')}{'，' + '，'.join(tags) if tags else ''}。像影视剧真人演员在演，不要播音腔，自然口语化，有呼吸感。"

def qwen_tts(sp, text, emotion, out):
    if not KEY: raise SystemExit('缺少 DASHSCOPE_API_KEY：请在 .dev.vars 中添加 DASHSCOPE_API_KEY=sk-xxx')
    clean = re.sub(r'\[[^\]]+\]\s*', '', text).strip()
    body = {'model': 'qwen3-tts-instruct-flash', 'input': {'text': clean, 'voice': VOICE.get(sp, 'Cherry'), 'language_type': 'Chinese',
            'instructions': instruction(sp, emotion, text), 'optimize_instructions': True}}
    req = urllib.request.Request(BASE + '/services/aigc/multimodal-generation/generation', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    j = json.load(urllib.request.urlopen(req, timeout=120))
    url = j['output']['audio']['url']
    wav = out + '.wav'; urllib.request.urlretrieve(url, wav)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ar', '44100', '-ac', '1', '-b:a', '64k', out]); os.remove(wav)
    return out

if __name__ == '__main__':
    dlg = json.load(open(os.path.join(D, 'dialogue_v3.json')))
    want = set(sys.argv[1:]) or {'P1'}
    os.makedirs(os.path.join(ROOT, 'public/static/comic/v3/line'), exist_ok=True)
    res = {}
    for sid in want:
        for i, l in enumerate(dlg['segments'][sid]['lines']):
            sp = l['speaker'] if l['speaker'] in VOICE else '林夏'
            out = os.path.join(ROOT, f'public/static/comic/v3/line/q_{sid}_{i}.mp3')
            qwen_tts(sp, l['text'], l.get('emotion', 'neutral'), out)
            res.setdefault(sid, []).append(out); print(sid, i, sp, 'ok', flush=True)
    json.dump(res, open(os.path.join(D, 'voice_qwen.json'), 'w'), ensure_ascii=False, indent=1)
