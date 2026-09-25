// 用 LLM 生成示范剧《天台》的变体内容（仅开发期运行一次，产物写入 scripts/seed-content.json）
import fs from 'fs';
const prompt = `你是互动短剧编剧。为对弈式交互剧《天台》生成JSON。世界观：近未来雨夜都市，数据掮客林夏(女,冷静,绝不伤害妹妹林小雨)与前搭档警探陈默(男,隐忍,欠林夏一条命)在38层天台交易一枚记录财团"穹顶"罪证的U盘；财团杀手"渡鸦"潜伏。
结构（节点ID固定）：
S1 场景"雨夜天台"；C1押注"林夏会把U盘交给陈默吗？" 结局簇: give(交出U盘,0.45) betray(转身交给渡鸦,0.40) drop(把U盘扔下天台,0.15)；
S2 场景"逃离穹顶大厦"；C2押注"他们会走哪条路逃生？" 结局簇: elevator(电梯遭伏击,0.40) stairs(消防梯脱身,0.35) trapped(被困38层,0.25)；
S3 场景"黎明对峙"；C3押注"陈默会扣下扳机吗？" 结局簇: shoot(开枪,0.35) lower(放下枪,0.45) together(同归于尽,0.20)。
要求：
1) scenes: S1/S2/S3 各给 lines 数组(5-6句)，每句 {speaker, text(≤28字), mood}，speaker 可为 旁白/林夏/陈默/渡鸦/林小雨(电话)。S2、S3 的开场要能兼容上一节点任意结局（用模糊过渡）。
2) 每个结局簇给 3 个变体 variants：前2个为普通变体(切入点不同：如不同视角/节奏/细节)，第3个为通用兜底变体(fallback, 简洁)。每个变体 {title(≤10字), angle(切入点描述≤16字), lines(3-4句同上格式), shot(镜头描述≤30字)}。同一结局簇的变体因果相同、表现不同。
3) 每个结局簇给 hint(一句剧情暗示≤14字，不得暗示结果)。
4) endings: 按C3结局给 shoot/lower/together 三个结局卡 {title, epilogue(≤60字)}。
只输出JSON：{"scenes":{"S1":{"title","lines"},...},"outcomes":{"give":{"hint","variants":[...]},...},"endings":{...}}`;
const r = await fetch(process.env.OPENAI_BASE_URL + '/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-5-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, stream: true })
});
let txt = '', buf = '';
const dec = new TextDecoder();
for await (const chunk of r.body) {
  buf += dec.decode(chunk, { stream: true });
  const parts = buf.split('\n'); buf = parts.pop();
  for (const l of parts) {
    if (!l.startsWith('data:')) continue;
    const d = l.slice(5).trim(); if (d === '[DONE]') continue;
    try { txt += JSON.parse(d).choices?.[0]?.delta?.content || ''; } catch {}
  }
}
fs.writeFileSync(new URL('./seed-content.json', import.meta.url), txt);
console.log('done', txt?.length);
