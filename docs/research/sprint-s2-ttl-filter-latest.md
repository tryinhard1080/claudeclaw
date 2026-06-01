
=== TTL filter shadow report - last 14 days ===

  Window:         2026-05-18T17:04:18.000Z
              to  2026-06-01T17:04:18.000Z
  Band (latest):  [1, 30] days
  Ticks observed: 4025

  Per-tick averages (across the candidate set after current filters):
    candidates total:      9.76
    candidates pass TTL:   0.34  (3.5% of total)
    filtered (resolves <min): 0.00  (0.0%)
    filtered (resolves >max): 9.42  (96.5%)

  TTL distribution:
    mean TTL of pass set:     29.36 days
    mean TTL of filtered set: 143.34 days

  Naive what-if (assumes uniform approval rate across TTL - unverified):
    if filter were ACTIVE, ~3.5% of candidates would survive
    ~96.5% of long-dated/short-dated candidates would be excluded
    expected days-to-50 lift: directionally proportional to mean-TTL drop
    mean-TTL ratio (filtered/pass): 4.88x
