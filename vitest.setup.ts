// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// Integration tests always run against the dedicated test database, never
// the dev database (see docker/postgres/init.sql: samkvetlo_test).
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
