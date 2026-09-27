// 影剧《穹顶之下 · 影剧版》：共用对弈引擎 + 影剧数据（9 段 Seedance 2.0 音画一体片段，5 结局）
import DATA from './data.json'
import { createEngine } from '../comic/factory'
const E = createEngine(DATA)
export const { COMIC, ROOT, SERIES, NODES, publicTree, withTicket, getConfig, setConfig, startRun, arm, bet, settle, rewind, advance, verify, totalEndings, myEndings, simulateTree, comicStats } = E
