#!/usr/bin/env bash
# Run the monorepo test suite one file at a time, sequentially, with a
# per-file timeout and a priority ordering. This avoids overloading the
# system, which happens when vitest runs many files/workers in parallel.
#
# Usage:
#   scripts/run-tests-seq.sh [TIMEOUT_SECONDS]
#
# Env:
#   TIMEOUT   per-file timeout in seconds (default 180, overridable by $1)

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TIMEOUT="${1:-${TIMEOUT:-180}}"

VITEST_FLAGS="run --no-file-parallelism --pool=forks --poolOptions.forks.singleFork=true --reporter=dot"

# Priority-ordered list of "package_dir::filter" entries.
# Lower in the list = lower priority (runs later).
TARGETS=(
  # --- P1: protocol + core pglite (fast, most important) ---
  "packages/pg-protocol::"
  "packages/pglite::tests/basic.test.ts"
  "packages/pglite::tests/types.test.ts"
  "packages/pglite::tests/array-types.test.ts"
  "packages/pglite::tests/utils.test.ts"
  "packages/pglite::tests/instantiation.test.ts"
  "packages/pglite::tests/describe-query.test.ts"
  "packages/pglite::tests/query-sizes.test.ts"

  # --- P2: core pglite features ---
  "packages/pglite::tests/drop-database.test.ts"
  "packages/pglite::tests/notify.test.ts"
  "packages/pglite::tests/user.test.ts"
  "packages/pglite::tests/templating.test.js"
  "packages/pglite::tests/triggers.test.js"
  "packages/pglite::tests/plpgsql.test.js"
  "packages/pglite::tests/clone.test.js"
  "packages/pglite::tests/dump.test.js"
  "packages/pglite::tests/largeobjects.test.js"
  "packages/pglite::tests/message-context-leak.test.ts"
  "packages/pglite::tests/xml.test.ts"
  "packages/pglite::tests/fts.simple.test.js"
  "packages/pglite::tests/fts.english.test.js"

  # --- P3: pglite contrib extensions ---
  "packages/pglite::tests/contrib/amcheck.test.js"
  "packages/pglite::tests/contrib/auto_explain.test.js"
  "packages/pglite::tests/contrib/bloom.test.js"
  "packages/pglite::tests/contrib/btree_gin.test.js"
  "packages/pglite::tests/contrib/btree_gist.test.js"
  "packages/pglite::tests/contrib/citext.test.js"
  "packages/pglite::tests/contrib/cube.test.js"
  "packages/pglite::tests/contrib/dict_int.test.js"
  "packages/pglite::tests/contrib/dict_xsyn.test.ts"
  "packages/pglite::tests/contrib/earthdistance.test.js"
  "packages/pglite::tests/contrib/file_fdw.test.ts"
  "packages/pglite::tests/contrib/fuzzystrmatch.test.js"
  "packages/pglite::tests/contrib/hstore.test.js"
  "packages/pglite::tests/contrib/intarray.test.js"
  "packages/pglite::tests/contrib/isn.test.js"
  "packages/pglite::tests/contrib/lo.test.js"
  "packages/pglite::tests/contrib/ltree.test.js"
  "packages/pglite::tests/contrib/pageinspect.test.js"
  "packages/pglite::tests/contrib/pg_buffercache.test.js"
  "packages/pglite::tests/contrib/pg_freespacemap.test.ts"
  "packages/pglite::tests/contrib/pg_stat_statements.test.ts"
  "packages/pglite::tests/contrib/pg_surgery.test.js"
  "packages/pglite::tests/contrib/pg_trgm.test.js"
  "packages/pglite::tests/contrib/pg_visibility.test.js"
  "packages/pglite::tests/contrib/pg_walinspect.test.js"
  "packages/pglite::tests/contrib/pgcrypto.test.ts"
  "packages/pglite::tests/contrib/seg.test.js"
  "packages/pglite::tests/contrib/tablefunc.test.js"
  "packages/pglite::tests/contrib/tcn.test.js"
  "packages/pglite::tests/contrib/tsm_system_rows.test.js"
  "packages/pglite::tests/contrib/tsm_system_time.test.js"
  "packages/pglite::tests/contrib/unaccent.test.js"
  "packages/pglite::tests/contrib/uuid_ossp.test.ts"

  # --- P4: pglite runtime targets (node only; deno needs deno runtime) ---
  "packages/pglite::tests/targets/runtimes/node-memory.test.js"
  "packages/pglite::tests/targets/runtimes/node-fs.test.js"

  # --- P5: extension packages ---
  "packages/pglite-pgvector::"
  "packages/pglite-pg_uuidv7::"
  "packages/pglite-pg_hashids::"
  "packages/pglite-pg_ivm::"
  "packages/pglite-pg_textsearch::"
  "packages/pglite-pgtap::"
  "packages/pglite-age::"
  "packages/pglite-postgis::"
  "packages/pglite-icu-full::"
  "packages/pglite-prepopulatedfs::"
  "packages/pglite-tools::"
)

pass=0; fail=0; timedout=0
declare -a FAILED=()
declare -a TIMEDOUT=()

total=${#TARGETS[@]}
i=0
start_all=$(date +%s)

for entry in "${TARGETS[@]}"; do
  i=$((i+1))
  pkg="${entry%%::*}"
  filter="${entry#*::}"
  label="$pkg${filter:+ $filter}"

  printf '\n\033[1m[%d/%d] %s\033[0m (timeout %ss)\n' "$i" "$total" "$label" "$TIMEOUT"

  start=$(date +%s)
  ( cd "$pkg" && rm -rf ./pgdata-test 2>/dev/null; \
    timeout "$TIMEOUT" npx vitest $VITEST_FLAGS $filter ) 2>&1
  code=$?
  end=$(date +%s)
  dur=$((end-start))

  if [ "$code" -eq 0 ]; then
    pass=$((pass+1))
    printf '  \033[32mPASS\033[0m (%ss)\n' "$dur"
  elif [ "$code" -eq 124 ]; then
    timedout=$((timedout+1)); TIMEDOUT+=("$label")
    printf '  \033[33mTIMEOUT\033[0m (%ss)\n' "$dur"
  else
    fail=$((fail+1)); FAILED+=("$label")
    printf '  \033[31mFAIL\033[0m (exit %s, %ss)\n' "$code" "$dur"
  fi
done

end_all=$(date +%s)

printf '\n\033[1m===== SUMMARY =====\033[0m\n'
printf 'total: %d  pass: %d  fail: %d  timeout: %d  elapsed: %ss\n' \
  "$total" "$pass" "$fail" "$timedout" "$((end_all-start_all))"

if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\nFAILED:\n'; printf '  - %s\n' "${FAILED[@]}"
fi
if [ "${#TIMEDOUT[@]}" -gt 0 ]; then
  printf '\nTIMED OUT:\n'; printf '  - %s\n' "${TIMEDOUT[@]}"
fi

[ "$fail" -eq 0 ] && [ "$timedout" -eq 0 ]
