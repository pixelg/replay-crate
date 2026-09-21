import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)
for (let i = 0; i < 15; i++) {
  const [a] = await sql`select image_url from artists where id = '1aX2dmV8XoHYCOQRxjPESG'`
  const [j] = await sql`select count(*)::int as n from jobs`
  if (a.image_url) { console.log(JSON.stringify({ after_s: i * 10, image: a.image_url, jobsLeft: j.n })); process.exit(0) }
  await new Promise((r) => setTimeout(r, 10_000))
}
console.log('not processed within 150s')
