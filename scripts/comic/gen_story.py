# Agent-1/7 · 漫剧《穹顶之下》剧情树生成：1 + 3 + 9 + 18 = 31 个抉择节点，66 个常规分支片段 + 13 个悔棋隐藏分支 + 3 个隐藏结局
import json, os, requests, concurrent.futures as cf, sys, re
BASE = os.environ['OPENAI_BASE_URL']; KEY = os.environ['OPENAI_API_KEY']
OUT = os.path.join(os.path.dirname(__file__), 'story.json')

def llm(prompt, effort='low'):
    for attempt in range(3):
        try:
            r = requests.post(BASE + '/chat/completions', stream=True, timeout=600, headers={'Authorization': 'Bearer ' + KEY},
                json={'model': 'gpt-5-mini', 'reasoning_effort': effort, 'stream': True, 'response_format': {'type': 'json_object'},
                      'messages': [{'role': 'user', 'content': prompt}]})
            txt = ''
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith('data:'): continue
                d = line[5:].strip()
                if d == '[DONE]': break
                try: txt += json.loads(d)['choices'][0]['delta'].get('content') or ''
                except Exception: pass
            return json.loads(txt[txt.find('{'):txt.rfind('}') + 1])
        except Exception as e:
            print('retry', attempt, e, file=sys.stderr)
    raise RuntimeError('llm failed')

BIBLE = """《穹顶之下》——近未来雨夜都市“新港”，穹顶财团用“天穹”AI系统监控全城。
人物：
- 林夏：28岁数据掮客，黑色波波头、黑色长风衣、左腕有发蓝光的接口。冷静、话少，底线：绝不伤害妹妹林小雨。
- 陈默：35岁前刑警，灰色风衣、松垮领带、左轮手枪。隐忍、重情，三年前林夏救过他的命。
- 渡鸦：穹顶的王牌杀手，黑色羽毛斗篷、白色鸟喙半面具、红色独眼目镜、长狙击枪。话极少，冷酷。
- 林小雨：20岁大学生，黄色雨衣、马尾、脖子挂相机，热血莽撞，偷偷调查穹顶。
- 顾衡：55岁穹顶财团董事长，银色背头、白色西装、金袖扣，笑里藏刀。
核心道具：记录穹顶“天穹”人体实验罪证的蓝色数据芯片“星核”。
主线：一夜之间，从38层天台交易开始，到黎明决定新港命运。节奏要快、反转要狠、每个分支都要有画面感。"""

SEG = '{"title":"≤10字","narration":"旁白≤70字，第三人称，有画面感","dialogue":[{"speaker":"林夏|陈默|渡鸦|林小雨|顾衡","text":"≤30字"}],"image":"英文漫画分镜描述≤70词：出场人物(用英文名 Lin Xia/Chen Mo/Raven/Lin Xiaoyu/Gu Heng)、动作、构图景别、光线","mood":"一个词"}'
RULES = """规则：question≤22字，不暗示结果；每个选项 label≤10字、hint≤14字(暗示但不剧透)；weight 为剧情抽取概率，同节点和为1，单项在0.15-0.6之间；category ∈ trust/betray/sacrifice/escape/violence/mercy/risk/deception/love/justice。
dialogue 1-2句。所有分支都必须与已发生的路径因果连贯。只输出JSON。"""

def top():
    return llm(f"""你是顶级漫剧编剧兼互动博弈设计师。{BIBLE}
生成开篇与第一个抉择：
{{"prologue":[3个片段 {SEG}],
 "root":{{"question":"...","outcomes":[3个 {{"key":"A|B|C","label","hint","weight","category","segment":{SEG}}}],
   "twist":{{"label":"悔棋后才出现的隐藏选项≤10字","hint","category","merge_into":"A|B|C 之一(该隐藏分支之后并入哪条线)","segment":{SEG}}}}},
 "hidden_endings":[3个隐藏结局(只在最终抉择悔棋时出现，比常规结局更出人意料) {{"key":"H1|H2|H3","label","hint","category","ending_title":"≤8字","segment":{SEG}}}]}}
{RULES}""")

def subtree(ctx, key, oc):
    return llm(f"""你是顶级漫剧编剧兼互动博弈设计师。{BIBLE}
已发生：{ctx}
第一抉择结果【{key}·{oc['label']}】：{oc['segment']['narration']}
现在生成此分支之后的完整子树（三层抉择），格式：
{{"node":{{"question","outcomes":[3个 {{"key":"1|2|3","label","hint","weight","category","segment":{SEG},
     "node":{{"question","outcomes":[2个 {{"key":"a|b","label","hint","weight","category","segment":{SEG},
         "node":{{"question":"最终抉择","outcomes":[2个结局 {{"key":"x|y","label","hint","weight","category","ending_title":"≤8字","segment":{SEG}}}]}}}}],
       "twist":{{"label","hint","category","merge_into":"a|b","segment":{SEG}}}}}}}],
   "twist":{{"label","hint","category","merge_into":"1|2|3","segment":{SEG}}}}}}}
要求：第二层3个分支走向差异大；第三层每节点2个选项+1个悔棋隐藏选项；第四层为结局，每个结局 narration 要有收束感（结局旁白可到90字），结局之间情感色彩不同（有悲有喜有反转）。
{RULES}""")

if __name__ == '__main__':
    t = top(); print('top ok', file=sys.stderr)
    ctx = ' '.join(s['narration'] for s in t['prologue']) + f" 抉择：{t['root']['question']}"
    with cf.ThreadPoolExecutor(3) as ex:
        subs = list(ex.map(lambda o: subtree(ctx, o['key'], o), t['root']['outcomes']))
    for o, s in zip(t['root']['outcomes'], subs): o['node'] = s['node']
    json.dump(t, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('saved', OUT)
