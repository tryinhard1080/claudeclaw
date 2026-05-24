
=== TTL filter shadow report - last 14 days ===

  Window:         2026-05-10T13:26:12.000Z
              to  2026-05-24T13:26:12.000Z
  Band (latest):  [1, 30] days
  Ticks observed: 3271

  Per-tick averages (across the candidate set after current filters):
    candidates total:      10.49
    candidates pass TTL:   0.40  (3.8% of total)
    filtered (resolves <min): 0.00  (0.0%)
    filtered (resolves >max): 10.09  (96.2%)

  TTL distribution:
    mean TTL of pass set:     18.14 days
    mean TTL of filtered set: 147.32 days

  Naive what-if (assumes uniform approval rate across TTL - unverified):
    if filter were ACTIVE, ~3.8% of candidates would survive
    ~96.2% of long-dated/short-dated candidates would be excluded
    expected days-to-50 lift: directionally proportional to mean-TTL drop
    mean-TTL ratio (filtered/pass): 8.12x
