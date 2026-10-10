import { THRILL_SCRIPTS } from '../../src/thrill/scripts'
const id = process.argv[2]
process.stdout.write(JSON.stringify(id ? THRILL_SCRIPTS.find((d) => d.series.id === id) : THRILL_SCRIPTS.map((d) => d.series.id)))
