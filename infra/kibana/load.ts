// `pnpm kibana:load [kibana url]`: writes the dashboards (objects.ts) to saved-objects.ndjson and
// imports them into Kibana (default http://127.0.0.1:5601, from `pnpm search:up`), replacing
// earlier versions. The ndjson can also be imported by hand: Stack Management → Saved objects.
import { writeFile } from 'node:fs/promises'
import { objects } from './objects.ts'

const kibana = process.argv[2] ?? 'http://127.0.0.1:5601'
const ndjson = `${objects.map((object) => JSON.stringify(object)).join('\n')}\n`
const file = new URL('./saved-objects.ndjson', import.meta.url)
await writeFile(file, ndjson)

const form = new FormData()
form.append('file', new Blob([ndjson], { type: 'application/ndjson' }), 'saved-objects.ndjson')
const res = await fetch(`${kibana}/api/saved_objects/_import?overwrite=true`, {
  method: 'POST',
  headers: { 'kbn-xsrf': 'replay-crate' },
  body: form,
}).catch((error: unknown) => {
  console.error(`Kibana isn't answering at ${kibana} (\`pnpm search:up\`?)`, error)
  process.exit(1)
})
const result = (await res.json()) as { success?: boolean; successCount?: number; errors?: unknown[] }
if (!res.ok || !result.success) {
  console.error('Kibana refused the import:', JSON.stringify(result.errors ?? result, null, 2))
  process.exit(1)
}
console.log(`Imported ${result.successCount} objects. Dashboards:`)
console.log(`  ${kibana}/app/dashboards#/view/rc-listening`)
console.log(`  ${kibana}/app/dashboards#/view/rc-search`)
