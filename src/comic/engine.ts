// 漫剧《穹顶之下》：共用引擎 + 漫剧数据
import DATA from './data.json'
import { createEngine } from './factory'
const E = createEngine(DATA)
export const { COMIC, ROOT, DEFAULT_CFG, getConfig, setConfig, baseOptions, jitterWeights, pickOutcome, startRun, arm, bet, settle, rewind, advance, verify, totalEndings, myEndings, simulateTree, comicStats } = E
