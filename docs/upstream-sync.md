# Upstream Sync Procedure

This fork tracks upstream (`amirlehmam/ocstatusline`) via the `upstream` remote. The `main` branch mirrors upstream exactly.

## Syncing upstream changes

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Fast-forward main to upstream/main
git switch main
git merge --ff-only upstream/main

# 3. Rebase the fork branch on updated main
git switch bun-single-binary
git rebase main

# 4. Resolve conflicts if any (see Conflict Resolution below)

# 5. Run CI to verify
make ci

# 6. Push updated fork branch
git push origin bun-single-binary --force-with-lease
```

## Conflict Resolution

Most conflicts will be in:
- `package.json` — our fork has different name, bin entry, scripts, deps
- `README.md` — our fork adds attribution badge and docs links
- `.github/workflows/` — we removed publish.yml, added CI

**Strategy**: Keep our fork's versions of these files. Upstream changes to source code in `src/` should apply cleanly.

## Branch Structure

| Branch | Purpose |
|--------|---------|
| `main` | Mirror of upstream/main (no local commits) |
| `bun-single-binary` | All fork divergence lives here |

Never commit directly to `main`. All work happens on `bun-single-binary` or feature branches off it.