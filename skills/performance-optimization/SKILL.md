---
name: performance-optimization
description: >
  Profile, diagnose, and fix performance bottlenecks in code and infrastructure.
  Use when response times are slow, CPU/memory is high, or under load testing.
  Activate with: "optimize this", "too slow", "performance issue", "N+1 query",
  "memory leak", "profiling".
---

# Performance Optimization

Measure first. Optimize the bottleneck. Never guess.

## Process

1. **Measure baseline** — get current numbers (p50, p95, p99 latency)
2. **Profile** — find where time is actually spent
3. **Identify bottleneck** — CPU? I/O? Network? DB?
4. **Fix the top bottleneck** — not the easiest one
5. **Measure again** — confirm improvement
6. **Repeat** until target met

## Common Bottlenecks

### Database
```sql
-- Add index for frequent queries
CREATE INDEX idx_users_email ON users(email);

-- Avoid N+1: use JOIN or include
SELECT u.*, p.* FROM users u JOIN profiles p ON p.user_id = u.id;
```

### Caching
```python
# Cache expensive computations
@cache(ttl=300)
def expensive_query(user_id):
    return db.query(...)
```

### Async I/O
```python
# Parallelize I/O-bound work
results = await asyncio.gather(fetch_a(), fetch_b(), fetch_c())
```

## Targets
- API p95 < 200ms
- Page load < 2s (LCP)
- DB query < 50ms

## Red Flags
- Optimizing before measuring
- Micro-optimizing a 1% bottleneck
- Adding caching before fixing the query
- No load test before production
