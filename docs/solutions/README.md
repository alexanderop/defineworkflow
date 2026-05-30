# Documented Solutions

A searchable knowledge store of past problems and durable learnings. Each unit of engineering
work should make the next one easier — this is where that compounding happens.

- One file per problem/learning: `docs/solutions/<category>/<slug>.md`
- YAML frontmatter for search and dedup (see the `compound` skill's `references/schema.md`)
- Two tracks: **bug** (something broke and was fixed) and **knowledge** (a practice/decision worth keeping)
- `index.md` is auto-maintained by a hook — do not edit it by hand
- Add entries with the `compound` skill; this store is read automatically at session start
