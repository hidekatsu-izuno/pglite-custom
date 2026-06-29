import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { amcheck } from '../../dist/contrib/amcheck.js'

it('amcheck', async () => {
  const pg = new PGlite({
    extensions: {
      amcheck,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS amcheck;')

  // Example query from https://www.postgresql.org/docs/current/amcheck.html
  const res = await pg.query(`
    SELECT bt_index_check(index => c.oid, heapallindexed => i.indisunique),
               c.relname,
               c.relpages
    FROM pg_index i
    JOIN pg_opclass op ON i.indclass[0] = op.oid
    JOIN pg_am am ON op.opcmethod = am.oid
    JOIN pg_class c ON i.indexrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE am.amname = 'btree' AND n.nspname = 'pg_catalog'
    -- Don't check temp tables, which may be from another session:
    AND c.relpersistence != 't'
    -- Function may throw an error when this is omitted:
    AND c.relkind = 'i' AND i.indisready AND i.indisvalid
    ORDER BY c.relpages DESC LIMIT 10;
  `)

  expect(res.rows).toHaveLength(10)
  expect(res.rows.every((row) => row.bt_index_check === '')).toBe(true)
  expect(res.rows.map((row) => row.relname)).toContain(
    'pg_proc_proname_args_nsp_index',
  )
  expect(res.rows.map((row) => row.relname)).toContain(
    'pg_attribute_relid_attnam_index',
  )
  expect(res.rows.every((row) => row.relpages > 0)).toBe(true)
})
