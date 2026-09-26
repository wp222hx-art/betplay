// 《心动回廊 ～传说之樱下的约定～》：共用对弈引擎 + 恋爱剧数据（27 段 Seedance 2.0 音画一体片段，21 结局）
import DATA from './data.json'
import { createEngine } from '../comic/factory'
const E = createEngine(DATA)
export const { COMIC, ROOT, SERIES, NODES, publicTree, withTicket, getConfig, setConfig, startRun, bet, settle, rewind, advance, verify, totalEndings, myEndings, simulateTree, comicStats } = E
