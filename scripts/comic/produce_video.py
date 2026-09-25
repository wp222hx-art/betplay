# 动态漫：把选定分镜用 Seedance 2.0（mini 档）做图生视频，5s/段，约 1,200 积分/段
# 用法：python3 produce_video.py P1 O_RA ...   （生成后运行 build_data.py 并重新 build）
import os, subprocess, sys, json, re
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
comic = json.load(open(os.path.join(D, 'comic.json')))
os.makedirs(os.path.join(ROOT, 'public/static/comic/video'), exist_ok=True)
for sid in sys.argv[1:]:
    out = os.path.join(ROOT, f'public/static/comic/video/{sid}.mp4')
    if os.path.exists(out): print(sid, 'skip'); continue
    up = subprocess.run(['gsk', 'upload', os.path.join(ROOT, f'public/static/comic/img/{sid}.webp')], capture_output=True, text=True).stdout
    url = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', up).group(0)
    desc = comic['segments'][sid]['image']
    prompt = f'Motion comic animation of this manhua panel. {desc} Rain falling, neon flicker, subtle character motion, slow camera push-in. Keep the exact art style, characters and composition. No text.'
    tmp = f'/tmp/v_{sid}.mp4'
    subprocess.run(['gsk', 'video', '-m', 'fal-ai/bytedance/seedance-2.0', '--tier', 'mini', '-r', '9:16', '-d', '5', '-i', url, '-o', tmp, prompt], capture_output=True, text=True, timeout=900)
    if os.path.exists(tmp):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-an', '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', out])
        print(sid, 'ok')
    else: print(sid, 'fail')
