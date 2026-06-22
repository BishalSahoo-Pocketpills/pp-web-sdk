# Release & Deploy — worker-per-branch model

How pp-web-sdk ships. Read this before touching deploys.

## Topology

| Branch (bishal) | Worker | URL | Surface |
|---|---|---|---|
| `staging` | `pp-sdk-staging` | `pp-sdk-staging.bishal-sahoo.workers.dev` | `*.webflow.io` |
| `canary` | `pp-sdk-canary` | `pp-sdk-canary.bishal-sahoo.workers.dev` | test page / cohort |
| `main` | `pp-web-sdk` | `pp-web-sdk.bishal-sahoo.workers.dev` | `try.pocketpills.com`, `www.pocketpills.info` |

Cloudflare **Workers Builds** watches the **`bishal`** remote
(`BishalSahoo-Pocketpills/pp-web-sdk`) and auto-deploys each branch to its
Worker. `origin` (`Pocketpills-marketing/pp-web-sdk`) is the org-canonical
repo for PRs/review/CI; it does NOT deploy.

## ⚠️ Each Worker's build Deploy command MUST be environment-scoped

`wrangler.toml`'s top-level `name` is the inert placeholder `pp-sdk-unbound`
**on purpose** — a bare `wrangler deploy` (forgot the flag) lands there, not
on production. Therefore every Worker's Cloudflare build **Deploy command**
must name its environment:

| Worker | Deploy command |
|---|---|
| `pp-sdk-staging` | `npx wrangler deploy --env staging` |
| `pp-sdk-canary` | `npx wrangler deploy --env canary` |
| **`pp-web-sdk`** | **`npx wrangler deploy --env production`** |

**If `pp-web-sdk`'s build uses the default `wrangler deploy` (no `--env`),
a prod ship will deploy to `pp-sdk-unbound` and production will NOT update.**
Set `--env production` on the prod build before the next ship.

## Branching model (the one rule)

Trunk is `main`. Deploy branches are **downstream** of reviewed `main`:

```
feature branch ──PR──▶ origin/main      (review + CI + release.yml version bump)
                          │
                          ▼ promote (fast-forward / merge)
              main ──▶ staging ──▶ canary ──▶ (PR) main-on-bishal = prod
```

- Code is **reviewed on `origin/main` first**, then promoted outward to the
  deploy branches. Deploy branches never carry un-reviewed code.
- Day-to-day:
  ```bash
  # after your PR merges to origin/main:
  git checkout staging && git merge --ff-only origin/main && git push both staging
  # verify on *.webflow.io, then:
  git checkout canary  && git merge --ff-only origin/main && git push both canary
  ```
- `git push both <branch>` pushes to origin AND bishal (bishal triggers the
  deploy). `main` is special — see below.

## Shipping to production

`bishal/main` is protected by a GitHub ruleset (`protect-main-prod-deploy`):
**direct pushes are rejected** (even `--no-verify`); changes must go through a
PR. So prod ships via a PR on bishal:

```bash
git fetch origin && git checkout origin/main      # ship EXACTLY reviewed main
git push bishal origin/main:refs/heads/ship       # push to a branch (allowed)
gh pr create -R BishalSahoo-Pocketpills/pp-web-sdk \
  --base main --head ship --title "Ship vX.Y.Z to prod" --body "UAT signed off"
gh pr merge -R BishalSahoo-Pocketpills/pp-web-sdk <PR#> --merge --delete-branch
# the merge updates bishal/main → Cloudflare builds → pp-web-sdk deploys
```

Always ship `origin/main` (the reviewed, version-bumped state), never local
working state.

## Rollback (break-glass — faster than git)

The require-PR rule makes a git rollback slow (needs a PR). For an incident,
use Cloudflare's instant rollback, then reconcile git after:

1. Cloudflare dashboard → `pp-web-sdk` Worker → **Deployments** → pick the
   last-good deployment → **Rollback**. Live in seconds, bypasses git.
2. Afterwards, open a revert PR on `bishal/main` so git matches what's live.

For a canary gone wrong: just stop pointing traffic at the canary URL (revert
the Webflow script tag) — no deploy needed.

## Edge cache

Workers static assets serve `cache-control: public, max-age=300,
must-revalidate`. After a deploy/rollback, the edge may serve the prior
bundle for up to 5 minutes; already-open browser tabs cache separately. For
urgent changes, expect ~5 min full propagation. Hard-refresh / incognito to
bypass when verifying.

## Branch hygiene

- `ship` branches from prod releases pile up on bishal — the
  `--delete-branch` on merge (above) cleans them. If one lingers:
  `gh api -X DELETE repos/BishalSahoo-Pocketpills/pp-web-sdk/git/refs/heads/ship`.
- `staging` / `canary` are protected against force-push + deletion
  (rulesets `protect-staging-history` / `protect-canary-history`).

## Two-repo discipline

`origin/main` (reviewed, ahead) and `bishal/main` (deployed prod) are
intentionally separate. `origin` is the source of truth; `bishal` is a deploy
mirror with **GitHub Actions disabled** (so its copy of `release.yml` can't
fight the require-PR ruleset). Never treat `bishal/main` as a place to do
work — it only receives reviewed releases via PR.

## Knowing what's deployed where (observability)

All branches share `main`'s `__PP_SDK_VERSION__`, so the version string
alone can't tell staging's build from prod's. Use the **commit**, not the
version:

```bash
wrangler deployments list --env staging      # shows commit SHA + timestamp
wrangler deployments list --env production
```

The Cloudflare dashboard Deployments tab shows each deploy's git commit +
branch. The Worker URL itself tells you the environment. (A bare
`wrangler deploy` deploying to `pp-sdk-unbound` is also how you'd spot a
misconfigured build — that Worker should never have real traffic.)

## Supply-chain note (SRI / CSP)

This model serves "latest on branch" from a stable URL, so **Subresource
Integrity (SRI) is impractical** — the bundle hash changes every release,
which would break a static `integrity=` attribute in Webflow on each deploy.
SRI only fits version-pinned URLs, which this model doesn't use.

Feasible mitigations instead:
- **CSP** on the Webflow pages: restrict `script-src` to the SDK Worker
  origin so only that host can load executable JS.
- A **company-owned domain** for the Worker (tracked separately) removes the
  personal-account exposure and is the bigger lever here.
See the loader-security guide in pp-docs for the full treatment.

## Guard rails in place

| Guard | Scope | Bypassable? |
|---|---|---|
| Fail-safe top-level worker name | bare `wrangler deploy` → `pp-sdk-unbound` | n/a |
| Committed `.githooks/pre-push` | blocks `main → bishal/both` locally | yes (`--no-verify`) |
| Ruleset `protect-main-prod-deploy` | `bishal/main` require-PR, no force-push/delete | **no** |
| Rulesets `protect-{staging,canary}-history` | block force-push/delete | no |
| GitHub Actions disabled on bishal | no release.yml conflict | n/a |

The local hook is committed at `.githooks/pre-push` and activated via
`core.hooksPath`. **Fresh clones must run once:**
```bash
git config core.hooksPath .githooks
```
(Git can't auto-apply this on clone — it's a deliberate, documented step.)
The server-side ruleset is the real guarantee regardless.
