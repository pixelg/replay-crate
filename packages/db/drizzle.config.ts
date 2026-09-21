import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // Injected by `varlock run` (see the db:migrate script). Not needed for `db:generate`.
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
})
