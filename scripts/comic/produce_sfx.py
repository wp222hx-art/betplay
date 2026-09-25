# 环境音 + 音效：ElevenLabs Sound Effects（环境底噪 20s 可循环；音效 1-4s）
import os, subprocess, concurrent.futures as cf
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
OUT = os.path.join(ROOT, 'public/static/comic/sfx')
AMB = {
 'rain_roof': 'Heavy rain pouring on a skyscraper rooftop at night, wind gusts, distant thunder rumble, water dripping off metal railings, seamless ambient loop',
 'rain_street': 'Rainy neon city street at night, rain on pavement, distant traffic hiss, occasional car passing through puddles, seamless ambient loop',
 'city_night': 'Futuristic cyberpunk city night ambience, distant hover traffic hum, faint sirens far away, electric neon buzz, seamless loop',
 'interior_hum': 'Quiet dark corporate building interior at night, low air conditioning hum, faint electrical buzz, rain on windows muffled, seamless loop',
 'server_room': 'Server room ambience, dense computer fans humming, electronic beeps and data chirps, cold machine drone, seamless loop',
 'stairwell': 'Concrete emergency stairwell ambience, echoing reverb, dripping water, distant muffled alarm, flickering fluorescent buzz, seamless loop',
 'boardroom': 'Luxury penthouse office at night, very quiet, soft rain against huge glass windows, subtle low tension drone, seamless loop',
 'alarm': 'Building security alarm blaring in the distance with red emergency tension, muffled klaxon echo, seamless loop',
 'dawn_wind': 'Early dawn on a city rooftop after rain, gentle wind, light drizzle ending, distant birds and waking city, calm melancholic, seamless loop'}
SFX = {
 'gunshot': ('Single loud revolver gunshot with echo off buildings in rain', 2),
 'explosion': ('Big explosion with debris and glass shattering, deep boom', 3),
 'thunder': ('Close loud thunder crack followed by rolling rumble', 4),
 'glass_break': ('Large window glass shattering', 2),
 'footsteps_run': ('Fast running footsteps splashing on wet concrete', 3),
 'elevator_ding': ('Elevator arrival ding and metallic doors sliding open', 2),
 'door_slam': ('Heavy metal door slamming shut with echo', 1.5),
 'chip_beep': ('Futuristic data chip activation beep with digital glitch whoosh', 1.5),
 'heartbeat': ('Tense slow deep heartbeat, cinematic', 3),
 'sniper_bolt': ('Sniper rifle bolt action cocking, metallic click, tense', 1.5),
 'crowd_gasp': ('Small crowd gasping in shock', 2),
 'rewind': ('Tape rewind whoosh, reversed cinematic swoosh with clock ticking backwards', 2),
 'lock': ('Heavy mechanical vault lock click with deep impact hit', 1.2),
 'reveal': ('Cinematic dramatic reveal hit, deep braam with shimmer', 3)}
def gen(name, prompt, d):
    out = os.path.join(OUT, name + '.mp3')
    if os.path.exists(out): return name, 'skip'
    for a in range(2):
        subprocess.run(['gsk', 'audio', '-m', 'elevenlabs/sound-effects', '-d', str(d), '-f', name, '-o', out, prompt], capture_output=True, text=True, timeout=300)
        if os.path.exists(out) and os.path.getsize(out) > 3000: return name, 'ok'
    return name, 'fail'
jobs = [(k, v, 20) for k, v in AMB.items()] + [(k, v[0], v[1]) for k, v in SFX.items()]
with cf.ThreadPoolExecutor(6) as ex:
    for r in ex.map(lambda j: gen(*j), jobs): print(*r, flush=True)
