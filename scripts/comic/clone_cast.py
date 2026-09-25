# 专属声线：用真人配音样本克隆角色音色（ElevenLabs Instant Voice Clone），把 custom_voice_id 写回 cast.json
# 用法：python3 clone_cast.py 林夏=/path/linxia.mp3 [陈默=https://...mp3 ...]
#   样本要求：干声，不要背景音乐和混响，单人，30 秒到 3 分钟，情绪要有起伏；可以用 "a.mp3,b.mp3" 传多段
# 克隆完成后重新跑：python3 produce_voice_v3.py && python3 build_data.py && npm run build
#   （音色变了会让缓存键失效，所以会自动重新配音）
import json, os, re, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.join(D, 'cast.json')
cast = json.load(open(P))
def url_of(x):
    if x.startswith('http'): return x
    out = subprocess.run(['gsk', 'upload', x], capture_output=True, text=True).stdout
    return re.search(r'https://www\.genspark\.ai/api/files/s/\w+', out).group(0)
for arg in sys.argv[1:]:
    name, files = arg.split('=', 1)
    if name not in cast: print('未知角色', name); continue
    urls = [url_of(f) for f in files.split(',')]
    params = {'voice_files': urls, 'voice_clone_type': 'instant', 'voice_description': cast[name]['brand']}
    r = subprocess.run(['gsk', 'audio', '-m', 'elevenlabs/voice-clone', '-p', json.dumps(params, ensure_ascii=False), '-f', f'clone_{name}', '-o', f'/tmp/clone_{name}.mp3', '你好，我是' + name + '。今晚，一切都会改变。'], capture_output=True, text=True)
    m = re.search(r'"custom_voice_id"\s*:\s*"([^"]+)"', r.stdout) or re.search(r'voice_id"\s*:\s*"([^"]+)"', r.stdout)
    if not m: print(name, '克隆失败', r.stdout[-500:], r.stderr[-300:]); continue
    cast[name]['custom_voice_id'] = m.group(1); print(name, '→', m.group(1), '试听：/tmp/clone_' + name + '.mp3')
json.dump(cast, open(P, 'w'), ensure_ascii=False, indent=1)
