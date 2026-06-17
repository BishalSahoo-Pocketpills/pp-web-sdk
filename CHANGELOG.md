# Changelog

All notable changes to **pp-web-sdk** are documented here. The project follows
[Semantic Versioning](https://semver.org/) — breaking changes require a major
or, at minimum, a documented migration path in this file.

## [3.11.1] — 2026-06-17

### Changed

- **Mixpanel cookie hygiene is now centralized and primary-anchored.** The
  per-secondary "legacy cookie sweep" (`sweepLegacyCookie` boot-profile flag)
  is replaced by `pruneNonPrimaryMixpanelCookies`, which runs once during
  `init()` and deletes **every** `mp_<token>_mixpanel` cookie whose token is
  not the **current primary** token (across the configured cross-subdomain
  `cookieDomain` and the host-only path). Secondary still persists to
  `localStorage`, so only the primary project ever writes a cookie. This
  guarantees a single Mixpanel cookie survives a **project swap** (old primary
  token → secondary, new token → primary) and a full secondary deprecation —
  preventing the two-cookie doubling that can trip the server "request
  header / cookie too large" (HTTP 400/431) error. _Migration:_ none — the
  prune is keyed on whatever is configured as primary, so swaps and
  staging/prod token differences need no code change.

### Added

- **Boot-time cookie-size telemetry (`reportPrimaryCookieSize`).** After the
  SDK loads, the orchestrator measures the primary `mp_<token>_mixpanel`
  cookie and the total `document.cookie` payload (UTF-8 byte count) and logs
  a `warn` when either crosses a threshold — visibility for the
  "cookie too large" failure before it becomes a hard error. Pure
  observability; never mutates Mixpanel's cookie.
- **`shared.cookieSizeWarnBytes` config** (`{ primary, total }`, defaults
  `3584` / `7168` bytes) to tune the telemetry thresholds to your CDN/server
  header limit.

## [3.11.0] — 2026-06-03

### Changed

- **Consent now gates `analytics.track()` and the dataLayer dispatch (C1).**
  Previously only `analytics.init()` was consent-gated; `track()` and the
  datalayer `pushEvent` / `pushEcommerceEvent` paths dispatched regardless.
  They now check consent before sending. **Behavior change, but inert by
  default:** with `consent.required = false` (the default), `isGranted()`
  returns `true`, so events fire exactly as before. Only deployments that set
  `consent.required = true` (or revoke consent) will see `track()` / datalayer
  pushes suppressed. _Migration:_ none required unless you depend on consent
  enforcement — in which case track-time and datalayer events are now correctly
  blocked when consent is denied.

### Added

- **`ppLib.analytics` namespace + `configure()` alias (C5).** Analytics is now
  exposed on the unified `ppLib.analytics` surface (alongside the existing
  `window.ppAnalytics`), matching every other module's `ppLib.<name>` IA. A
  backward-compatible `configure()` alias of `config()` is also available.

### Fixed

- **Consent vocabulary alignment (C2).** The analytics consent service now
  accepts both `'approved'` and `'granted'` stored values, so it agrees with the
  shared `ppLib.consent` service on the `pp_consent` key (previously the two
  could disagree — the analytics side honored only `'approved'`).
- **Observability (C4).** GTM events dropped by the rate limiter are now logged
  with the dropped event name instead of being discarded silently.

### Docs

- Documentation (`pp-docs`) rewritten end-to-end to match shipped v3.x behavior
  (audit remediation), with a new doc-from-types lint guarding against future
  signature drift.

## [3.10.7] — 2026-05-29

### Fixed

- **Stop firing boot-time `people.*` dispatches for anonymous visitors.**
  Closes [Issue #22](https://github.com/Pocketpills-marketing/pp-web-sdk/issues/22),
  which a 4-Principal documentation review surfaced after the v3.10.4
  `identify` gate landed. The previous release stopped automatic
  `identify(userId)` on anonymous visitors but left six boot-time
  `people.set` / `people.set_once` dispatches firing unconditionally:
    - `registerExperimentCookie` (shared-context.ts:87) — exp super-prop's
      `set_once`
    - `registerMarketingAttribution` (shared-context.ts:97) — marketing
      attribution profile copy
    - `bridgeVwoProps` (shared-context.ts:202) — VWO experiment-property
      bridge
    - `resetSessionCampaign` (campaign.ts:67) — session-boundary UTM reset
    - `registerCampaignParams` (campaign.ts:108) — last-touch UTM profile
    - `registerCampaignParams` (campaign.ts:110) — first-touch UTM `set_once`

  Under Mixpanel's Simplified ID Merge model, `people.*` writes against an
  anonymous `distinct_id` (`$device:<uuid>`) materialise a real user
  profile keyed on the device id. This polluted user counts (every
  anonymous visitor became a unique "user"), inflated DAU/MAU, and
  required a redundant server-side profile-merge step on the eventual
  `identify(userId)`.

  Each callsite now short-circuits when the visitor is anonymous via a
  new `isAuthenticated(pp)` helper in `src/mixpanel/auth-state.ts`. The
  helper reads the SDK's `logged_in` event property (derived from the
  `userId` / `patientId` / `app_is_authenticated` cookies Angular owns)
  — same signal `unifyDistinctIdWithPpDistinctId` already gates on.

  The corresponding `register` / `register_once` (super-property) writes
  stay unconditional — those attach to events going forward, not to a
  profile, so anonymous events still carry the right marketing/experiment
  context.

  **Behavioural impact:**
  - Anonymous visitors no longer materialise `$device:<uuid>`-keyed
    Mixpanel profiles at boot. The v3.10.4 release's "eliminates
    premature user profiles" claim is now complete (it was partially
    true before — only the `identify` path was gated).
  - First-touch UTM `set_once` does not lock onto the anonymous profile;
    instead it locks onto the real identified profile when the visitor
    later authenticates and the boot path re-fires.
  - Manual `ppLib.mixpanel.people.*` callers are unaffected — the gate
    only covers the SDK's six boot-time dispatches. Callers should still
    gate their own `people.*` writes on auth state; see the warning
    callouts on every `people.*` API doc page.

  **Verification:** in Mixpanel, the count of profiles where
  `\$distinct_id LIKE '$device:%'` AND `\$created` is after this fix's
  deploy should drop to near-zero (some pre-fix events may still flush
  from queues for ~30 min).

  **Testing:** 4 new test cases in `tests/mixpanel/mixpanel.test.ts`
  under `Anonymous-profile gate (Issue #22)` — three negative-coverage
  asserts (each boot-time site does NOT fire `people.*` for anonymous)
  plus one positive-coverage assert (all dispatches fire when
  authenticated). Existing 6 tests that asserted the unconditional
  behaviour were updated to set `app_is_authenticated=true`.

## [3.10.6] — 2026-05-29

No SDK code changes — this version was auto-bumped by the post-merge
versioning hook one last time after PR #21 (the v3.10.5 CHANGELOG backfill)
landed, before PR #23 wired the docs-only skip path into `release.yml`.
The bump is now a closed loop: subsequent docs-only PRs will leave
`package.json` untouched and no further phantom versions will accumulate.

Use v3.10.4 as the functional baseline. v3.10.5 and v3.10.6 carry no
behaviour deltas.

## [3.10.5] — 2026-05-29

No SDK code changes — auto-bumped by the post-merge versioning hook
after PR #20 landed a documentation-only update (the v3.10.4 README +
ANALYTICS-CONTRACT alignment and the full CHANGELOG backfill from
v3.6.2 → v3.10.4). The tag is preserved so consumers don't see a missing
version in the registry.

If you read this entry on a consumer dashboard expecting behaviour deltas
from v3.10.4: there are none. Use v3.10.4 as the functional baseline.

## [3.10.4] — 2026-05-28

### Fixed

- **Stop calling `identify()` for anonymous visitors.** Per Mixpanel's
  Simplified ID Merge guidance, the auto-generated `$device:<uuid>`
  distinct_id must be preserved until the visitor authenticates. The boot
  path (`unifyDistinctIdWithPpDistinctId`) now hard-short-circuits when
  `logged_in !== 'true'`, eliminating premature user profiles (anonymous
  visitor → `$user_id = device_id` profile) and the redundant profile-
  merge step at login. Authenticated visitors are still auto-identified
  exactly as before.

## [3.10.3] — 2026-05-28

### Fixed

- **Per-event marketing-attribution key aligned with the super-property
  name.** Renamed the per-event payload key `marketing_attribution`
  (snake_case) to `marketingAttribution` (camelCase) to match the
  Mixpanel super-property registration in `shared-context.ts`. Pre-fix,
  every Mixpanel event carried both columns with identical values.
- **Per-event device-model key capitalised.** Renamed `device` to
  `Device` to match the `Country` proper-noun convention.
- **Tightened `marketingAttribution` type** from `unknown` to
  `NormalizedTouch | null` in `BuiltEventProperties` so callers get
  autocomplete on the 9 fixed fields.

## [3.10.2] — 2026-05-28

### Changed

- **`$device_id` is now read live from Mixpanel for non-Mixpanel
  destinations.** The event-properties builder calls
  `window.mixpanel.get_property('$device_id')` each `build()`; the
  `pp_device_id` SDK-side mirror cookie is removed. Mixpanel's
  `mp_<token>_mixpanel` cookie is the single source of truth. The
  mixpanel module sweeps any stale `pp_device_id` cookie once on boot
  via `deleteLegacyPpDeviceIdCookie()`. Non-Mixpanel destinations
  (dataLayer/GA4, Braze) see the same UUID Mixpanel uses without any
  synchronisation lag, and post-`mp.reset()` rotations propagate to the
  next event without a page reload.

## [3.10.1] — 2026-05-28

### Fixed

- **Unify session ID via the common session service.** The session
  service is now the single source of truth; modules that previously
  read session state ad hoc now route through it.

## [3.10.0] — 2026-05-28

### Changed

- **Secondary Mixpanel instance uses `persistence: 'localStorage'`** so
  only the primary instance writes an `mp_<token>_mixpanel` cookie. Halves
  cookie footprint for dual-instance deployments; identity stays consistent
  via `syncIdentityFromPrimary` re-pinning secondary on every page load.

## [3.9.0] — 2026-05-28

### Added

- **Analytics auto-events gate on `ppLib.mixpanelReady`.** Auto-pageview
  and attribution capture now wait for Mixpanel's `loaded` callback (or
  the 3-second timeout fallback) before dispatching, so all destinations
  (Mixpanel + dataLayer + Braze) see the same `$device_id` at event time.

## [3.8.0] — 2026-05-28

### Changed

- **`device_id` source switched from SDK-generated to Mixpanel-sourced.**
  The event-properties builder now reads the anonymous device identifier
  from Mixpanel rather than minting and persisting its own UUID. Precursor
  to the full mirror-cookie removal in v3.10.2.

## [3.7.0] — 2026-05-28

### Added

- **`ppLib.mixpanelReady` Promise.** Resolves after Mixpanel's `mp.init`
  `loaded` callback fires, with a 3-second timeout fallback so non-Mixpanel
  destinations still emit events when Mixpanel is blocked. Modules that
  need consistent identifiers across destinations should `await` this
  before dispatching initial auto-events.

## [3.6.22] — 2026-05-28

### Changed

- Code cleanup: removed dead code paths, fixed lingering type issues
  surfaced during the v3.6.21 refactor.

## [3.6.21] — 2026-05-28

### Changed

- Decomposed `src/analytics/index.ts` into 8 sub-modules
  (tracker, platforms, queue, etc.) for testability and clearer module
  boundaries.

## [3.6.20] — 2026-05-28

### Changed

- Extracted `determineLoginState` and `buildClickIdAttribution` helpers
  from `buildFlat()` in the event-properties builder.

## [3.6.19] — 2026-05-28

### Changed

- Guard-clause refactor + structural merge in the UTM capture path of the
  event-properties builder.

## [3.6.18] — 2026-05-27

### Changed

- Split `event-properties-builder.ts` into `utm-types.ts` (type-only) +
  `attribution.ts` (resolver). The builder now imports from both.

## [3.6.17] — 2026-05-27

### Changed

- Extracted shared helpers: SRI validation, element-debounce-key derivation,
  UTM fallback. Reduces module duplication across braze, mixpanel, and the
  event-source dispatcher.

## [3.6.16] — 2026-05-27

### Changed

- Migrated `event-source` to the shared `createDebounceTracker` helper
  (consolidates the third inline debounce implementation onto the common
  primitive introduced earlier in the v3.6 series).

## [3.6.15] — 2026-05-27

### Changed

- Extracted shared `ensureDataLayer` and `isConsentGranted` helpers from
  the analytics and datalayer modules.

## [3.6.14] — 2026-05-27

### Changed

- Extracted `cloneConfig` helper into `src/common/`; replaced 11 inline
  `JSON.parse(JSON.stringify(...))` round-trips across the SDK.

## [3.6.13] — 2026-05-27

### Changed

- Extracted the shared Mixpanel-dispatch bridge into `src/common/`. The
  analytics, ecommerce, and event-source modules now route Mixpanel calls
  through the same fallback-aware bridge.

## [3.6.12] — 2026-05-27

### Changed

- Extracted shared UUID generator into `src/common/`.
- Typed `LogLevel` as a string-union literal type rather than bare `string`,
  so the compiler catches typos at log call sites.

## [3.6.11] — 2026-05-27

### Security

- `validateData` now accepts primitive values (number, boolean, string)
  in addition to objects, and stringifies them before downstream consumers
  receive the payload.
- `ppLib.Storage.get` gained a runtime validator slot so callers can reject
  malformed persisted state at read time.

## [3.6.10] — 2026-05-27

### Reverted

- The UTM field truncation introduced in v3.6.5 is removed. With UTM touch
  state living in localStorage (v3.6.9), there is no HTTP-header pressure
  on the per-field length, so the truncation can safely come out.

## [3.6.9] — 2026-05-27

### Changed

- **`pp_utm_first_touch` and `pp_utm_last_touch` moved from cookies to
  localStorage.** Eliminates ~1 KB of URL-encoded JSON from every HTTP
  request header. The legacy cookies are deleted on first read after the
  upgrade (one-time migration).

## [3.6.8] — 2026-05-27

### Changed

- **Stopped dual-writing session cookies.** The short-name fallbacks
  (`_pps` / `_ppsa`) introduced in v3.3.0 and used as the dual-write
  fallback target in v3.6.3 are no longer written. Long-form names
  (`pp_analytics_session_id` / `pp_analytics_last_activity`) are the
  only persistent storage now.

## [3.6.7] — 2026-05-27

### Fixed

- **UTM-cookie repair runs eagerly at builder creation.** The v3.6.6 repair
  was lazy (deferred until the first `build()`), which left a window where
  the next request still shipped the oversized cookie. The repair now runs
  synchronously at `createEventPropertiesBuilder()`.

## [3.6.6] — 2026-05-27

### Fixed

- **One-time repair of oversized UTM cookies on boot.** Catches visitors
  whose pre-v3.6.5 cookies exceed nginx's 8 KB header buffer (typically a
  campaign with a long `utm_term`/`utm_content`). Cookies that would still
  overflow after truncation are deleted entirely; the next visit captures
  fresh attribution.

## [3.6.5] — 2026-05-27

### Fixed

- **Truncate UTM cookie fields to prevent nginx 400 overflow.** Individual
  UTM fields (source, medium, campaign, content, term) are capped before
  serialisation so logged-in users with Mixpanel + Angular auth + UTM
  cookies stay under the 8 KB header buffer. (Later superseded by the
  localStorage migration in v3.6.9 and reverted in v3.6.10.)

### Docs

- Replaced `docs/ANALYTICS-CONTRACT.md` with a redirect pointer to the
  pp-docs site (canonical analytics contract now lives at
  `https://pp-docs.pages.dev/guides/v3`).

## [3.6.4] — 2026-05-24

### Changed

- **Attribution defaults: `utm_content` and `utm_term` default to `'none'`
  on direct visits** (was `'$direct'`), to distinguish "direct traffic with
  no creative/keyword context" from "creative/keyword genuinely absent".
  `utm_source` / `utm_medium` / `utm_campaign` continue to default to
  `'$direct'`. Reports filtering on `utm_content = '$direct'` /
  `utm_term = '$direct'` for direct visits should switch to `= 'none'`.

## [3.6.3] — 2026-05-23

### Fixed

- **Session cookies dual-write under both long-form and short names.**
  Persists `pp_analytics_session_id` / `pp_analytics_last_activity` as the
  read primary AND `_pps` / `_ppsa` as a fallback. The long-form names are
  what downstream consumers (GTM tags, BigQuery exports, the Angular
  webapp) key off; the short opaque names from v3.3.0 stay alive as a
  hardening fallback. Same 30-min sliding TTL on all four cookies; both
  names rewritten on every `getOrCreateSessionId()` call.
  (Later simplified back to the long-form names only in v3.6.8 once the
  fallback proved unnecessary in practice.)

## [3.6.2] — 2026-05-22

### Docs

- Curated v3.6.0 and v3.6.1 release notes in CHANGELOG.

---

## Pre-v3.6.2 unreleased history

The section below was accumulated under "Unreleased" prior to the
per-version backfill above. The bullets overlap heavily with the v3.6.0
and v3.6.1 entries (the original v3.6.0 / v3.6.1 release-note curation
in [3.6.2] explicitly extracted the per-version content from this list)
and are retained here as a historical record of the SDK's evolution
through the dual-instance Mixpanel rollout. Newer per-version sections
(v3.6.2 onwards) are authoritative; treat the bullets below as legacy.

### Changed

- **Session cookies dual-write: `pp_analytics_session_id` /
  `pp_analytics_last_activity` (read primary) + `_pps` / `_ppsa`
  (read fallback).** The session ID and last-activity timestamp are
  now persisted under BOTH the long-form names AND the short opaque
  names introduced in v3.3.0. The long-form names are the read primary
  — that's what downstream consumers (GTM tags, BigQuery exports, the
  Angular webapp reading on the same domain) key off. The short names
  are kept alive as a fallback so the v3.3.0 hardening intent (obscure
  names less inviting for inspection / tampering) remains usable if
  the long names get cleared or blocked.
  - **Read order:** `pp_analytics_session_id` → `_pps` → legacy
    localStorage `pp_analytics_session_id` → generate fresh.
  - **No auto-purge.** The prior one-time migration that deleted
    `pp_analytics_*` cookies after copying their value into `_pps` is
    removed. Both names stay alive for the session lifetime.
  - **Same 30-min sliding TTL** on all four cookies, written together
    on every `getOrCreateSessionId()` call so neither name outlives
    the other.
  - **Self-healing:** if `_pps` survives while `pp_analytics_*` was
    selectively cleared, the next read restores the long-form cookie
    via the standard dual-write path.
  - **`clearSession()`** wipes all four cookies + the legacy
    localStorage entries.
  - Tradeoff: the explicit `pp_analytics_*` names re-expose the
    session identifier under a recognizable label, partially undoing
    the v3.3.0 rename's obscurity. Accepted intentionally — external
    consumers that key off the long-form name (GTM, BigQuery) outweigh
    the marginal obscurity benefit of the rename alone.

### Security

- **Unified consent gate above per-SDK opt-outs (`ppLib.consent`).**
  Adds a single dispatch-time consent check above the existing per-SDK
  opt-out toggles (Mixpanel's `optOutByDefault`, Braze's session gate).
  All event-dispatch paths now drop silently when consent is denied —
  no log noise during a denied session, no stub-queue accumulation.
  - API: `ppLib.consent.isGranted()` / `status()` / `grant()` /
    `revoke()` / `configure({ mode, storageKey })`.
  - Resolution order: (1) `win.ppAnalytics.consent.status()` if
    installed (single source of truth); (2) localStorage `pp_consent`
    value (`'denied'` / `'granted'` / legacy `'approved'`); (3) fallback
    by mode — `'opt-out'` (default) grants, `'opt-in'` (GDPR) denies.
  - Gated dispatch sites: `mixpanel.track` facade, `ecommerce`
    dispatch (GTM + Mixpanel), `event-source` dispatch (GTM + Mixpanel
    + VWO), `braze.events.handleInteraction`, `braze.forms.handleSubmit`,
    `braze.purchases.handlePurchaseClick`, `braze.purchases.trackPurchase`,
    and `braze.trackEvent`. Voucherify is pricing infrastructure, not
    analytics — left ungated.

- **Subresource Integrity (SRI) for Braze and Mixpanel SDK loads.**
  The Braze and Mixpanel CDN script tags now accept three new optional
  config fields — `integrity`, `crossOrigin`, and `requireIntegrity` —
  plus a `cdnUrl` override on the Mixpanel loader (Braze already had
  one). When `integrity` is set, the loader applies it and forces
  `crossOrigin = 'anonymous'` (overridable). When `requireIntegrity:
  true` is set without an `integrity` hash, the loader refuses to
  inject the script AND does not install the stub, so callers don't
  silently queue events into an orphan queue. Hash format is validated
  against `sha(256|384|512)-<base64>` and typos are rejected with an
  actionable error. The default path (no integrity configured) is warn-
  only — existing deployments are unaffected. The Mixpanel script tag
  now also has an `onerror` handler so SRI mismatches surface in logs
  instead of silently breaking analytics.
  - **Migration path (recommended Phase-1 → Phase-3 rollout):**
    - Phase 1 (no action): the SDK ships with warn-only logs. Existing
      deploys continue working unchanged.
    - Phase 2: pin a specific SDK version (`cdnUrl`) and configure
      `integrity` with the matching `sha384-` hash. Logs go quiet.
    - Phase 3: flip `requireIntegrity: true` to make stale hashes
      fail-closed instead of warn-only.

- **Hardcoded third-party URLs documented.** Braze's `5.6/` minor-pin
  CDN, Voucherify's `as1.` Singapore region, and VWO's historical
  `dev.` prefix subdomain now have inline comments explaining why they
  are intentional and how to override.

- **BREAKING — voucherify: `clientSecretKey` is now refused in
  browser-direct mode.** The Voucherify module previously sent the
  server-side secret as the `X-Client-Token` header from the browser when
  no proxy or edge consumer was configured. The audit's pre-existing
  warn-only check fired only on the literal string `edge.mode === 'direct'`
  and silently bypassed `undefined` / `''` / `'cms'`. `init()` now hard-
  blocks initialization for every non-`'edge'` mode when `clientSecretKey`
  is configured without `cache.enabled=true`, and `apiRequest()` enforces
  the same rule per call as defense-in-depth.
  - **Migration path 1 (recommended):** rename your config field from
    `clientSecretKey` to the new `clientPublicKey` slot and configure the
    Voucherify *client-side* API token in the browser. Voucherify supports
    a public token explicitly intended for browser use.
  - **Migration path 2:** put a server-side proxy in front of the Voucherify
    API and configure `cache.enabled: true` with `cache.baseUrl` pointing
    at it. The SDK still ships `clientSecretKey` in config but never
    transmits it from the browser — the proxy consumes it server-side.
  - **Migration path 3:** stand up the edge worker (`edge.mode: 'edge'`)
    and let it terminate Voucherify calls server-side. Same outcome as
    proxy mode.
  - Customers continuing to set `clientSecretKey` in browser-direct mode
    will see an error log `[ppVoucherify] BLOCKED init: ...` and the
    module will not initialize.

- **BREAKING — datalayer: anchor click redirects are now origin-validated.**
  `<a data-dl-event>` clicks previously assigned `window.location.href`
  from the anchor's `href` with no validation. An attacker-injected anchor
  could fire a dataLayer event then redirect off-site. Cross-origin
  redirects are now blocked unless the host matches
  `DataLayerConfig.allowedRedirectHosts` (default `['pocketpills.com']`).
  - **Migration path:** if your site links to non-`pocketpills.com` domains
    via tracked anchors, add those hosts to the allowlist via
    `ppLib.datalayer.configure({ allowedRedirectHosts: ['partner.com', ...] })`.
    Subdomains are matched via the `.host` suffix rule, so listing the
    apex domain covers all subdomains.
  - Blocked redirects log a warn with the rejected hostname. The dataLayer
    event still fires; only navigation is dropped.

- **PII-safe logging:** `ppLib.safeLogPayload(value)` and
  `ppLib.safeLogError(err)` redact PII before payloads reach console /
  DevTools / Sentry. Both are now required members of `PPLib`. All Braze,
  Voucherify, and 16 other modules' `ppLib.log('error', ..., e)` sites
  route through `safeLogError`. The contract is the log SHAPE, not the
  values — log scrapers must not parse output to recover content.
  - **Compatibility:** the data argument shape passed to `ppLib.log` for
    error sites changed from raw `Error` objects to a structured
    `{ errorClass, messageShape, endpoint?, status?, attempt?, cause?, ... }`.
    Test assertions using `expect.any(Error)` should migrate to
    `expect.objectContaining({ errorClass: expect.any(String) })`.
  - Local debug builds can opt into raw message + stack via
    `ppLib.config.debugErrors = true`. Default off.

- **utm-params now use Mixpanel-style `[first touch]`/`[last touch]` keys.**
  The dataLayer enricher emits `'utm_source [first touch]'` /
  `'utm_source [last touch]'` (etc.) instead of the old
  `utm_source_first_touch` / `utm_source_last_touch`. Defaults are
  `$direct` for source and `none` for medium/campaign on direct visits.
  - **Migration:** any GTM tag, GA4 custom dimension, or BigQuery export
    query referencing `utm_*_first_touch` snake_case keys must be updated
    to read the new bracket-format keys.

### Added

- `ppLib.eventPropertiesBuilder` — single source of truth for canonical
  event-property context. Memoizes stable fields (browser, device_type,
  device_id, country) and recomputes volatile ones (URL, login state,
  attribution) per call. Consumed by both the dataLayer enricher and the
  Mixpanel `track()` facade so GTM and Mixpanel see the same shape.

- `ppLib.mixpanel.track(name, props)` — internal SDK facade for sending
  events to Mixpanel with the canonical context merged in. Direct
  `window.mixpanel.track(...)` calls in the analytics, ecommerce, and
  event-source modules now route through this. GTM-fired
  `mixpanel.track` calls are intentionally untouched (clean module
  boundary).

- `ppLib.eventPropertiesBuilder` and `ppLib.mixpanel.track` carry full
  per-event context: `current_url`, `device_id`, `pp_user_id`,
  `pp_patient_id`, `pp_session_id`, `is_logged_in`, `country`, `browser`,
  `device_type`, ad-platform click IDs (`gclid`, `fbclid`, etc.),
  `marketing_attribution`, plus the UTM touch-attribution keys.

- Mixpanel `distinct_id` is now unified with the SDK's `pp_distinct_id`
  in the `loaded` callback. Logged-in users get `pp_user_id`; anonymous
  users get the SDK's `device_id`. Cross-tool joins (Mixpanel ↔ Braze ↔
  GA4) work without translation between Mixpanel's `$device:` prefix
  and our identifier scheme.

- Voucherify pricing now falls back to **baseline** (basePrice as both
  retail and discounted) when the API fails, instead of leaving the DOM
  cloaked. Structured `{ errorClass, endpoint, status }` log emitted on
  failure.

- New typed Voucherify error hierarchy in `src/voucherify/errors.ts`:
  `VoucherifyError`, `VoucherifyConfigError`, `VoucherifyApiError`,
  `VoucherifyPricingError`. Replaces all `throw new Error(...)` sites in
  the module.

### Changed

- **Property stripping: null / undefined / empty-string removed from
  user + event property bags before dispatch.**
  - `buildFlat()` and `buildNested()` on the event-properties builder
    now strip null / undefined / empty values from the returned bundle.
    Mixpanel ingests empty strings as legitimate "(empty)" segments,
    which pollutes funnels and breaks BigQuery exports; the SDK now
    omits them at the builder boundary.
  - DataLayer enricher applies the same stripping by default. New
    `DataLayerConfig.preserveEmptyProperties` flag (default `false`)
    can be flipped to `true` to opt out — useful for GTM consumers
    that depend on a fixed schema shape with explicit nulls.
  - Exposed `stripEmptyProps(record)` from
    `@src/common/event-properties-builder` for callers that build
    custom payloads and want the same semantics.

- **Mixpanel default `emitMode: 'flat'` + flat ecommerce keys.**
  - The Mixpanel module's `emitMode` default is now `'flat'` (was
    `'dual'`). Per the Analytics events spec, Mixpanel receives a
    flat key shape — no `page` / `userProperties` / `eventProperties`
    / `attribution` nested wrappers on the per-event payload. Callers
    that want the dual shape can still opt in via
    `configure({ emitMode: 'dual' })`.
  - **Ecommerce → Mixpanel now flat-shaped.** The ecommerce dispatcher
    flattens `{ value, currency, items: [...] }` to flat keys for
    Mixpanel only: `ecommerce_value`, `ecommerce_currency`,
    `ecommerce_item_count`, `item_ids[]`, `item_names[]`,
    `item_brands[]`, `item_categories[]`, `item_prices[]` (numbers;
    unparseable prices fall through to `0` so NaN never reaches the
    wire), `item_quantities[]`. **dataLayer / GTM is unchanged** —
    keeps the nested GA4 shape (`ecommerce: { value, currency,
    items: [...] }`). Reports that key off `value` / `currency` /
    `items` on the Mixpanel side need to be updated to read the new
    flat keys.

- **First-touch UTM lock — Mixpanel `register_once` / `people.set_once`.**
  The Mixpanel module now registers `utm_* [first touch]` super-
  properties via `register_once` (instead of `register`) and writes
  the people-profile copy via `people.set_once` (instead of
  `people.set`). The SDK already locks first-touch on the persistence
  side (`getFirstTouchUtm` only writes when no first-touch is stored);
  the Mixpanel-side `_once` calls add defense-in-depth so a user
  whose cookies were cleared cannot have their original profile
  first-touch values overwritten on a subsequent visit. Last-touch
  registration is unchanged (`register` / `people.set`).

- **UTM last-touch resolution per Analytics spec (5-step resolver).**
  The `eventPropertiesBuilder` now resolves `utm_*` values via the
  spec'd cascade on first-ever capture: (1) explicit URL params win;
  otherwise (2) recognized search-engine referrer → `utm_source =
  <engine>`, `utm_medium = organic`; (3) any other external referrer →
  `utm_source = <root-domain>`, `utm_medium = referral`; (4) no
  referrer → `utm_source = $direct`, `utm_medium = $direct`; (5) on
  subsequent visits without URL params, carry forward the existing
  last-touch (referrer/search fallbacks run **only** on first-ever
  capture, never on session rotation). Self-referrals (same root
  domain as `cookieDomain`) are excluded. Search-engine recognition
  uses an 8-engine token list (google/bing/yahoo/duckduckgo/baidu/
  yandex/ecosia/brave) anchored with a trailing-dot guard to avoid
  `googleads.example.com` false positives. Root-domain extraction uses
  a Public Suffix List hybrid (last-2-parts default + ~30 multi-part
  TLD exceptions like `co.uk`).
  - **BREAKING (analytics contract):** the default fallback for *all*
    `utm_*` dimensions on direct visits is now `'$direct'` (was
    `'none'` for medium/campaign/content/term, only source got
    `'$direct'`). Uniform across `utm_source`/`medium`/`campaign`/
    `content`/`term`, on both `[first touch]` and `[last touch]` super-
    properties and per-event payloads. Reports filtering on `medium =
    'none'` need updating to `medium = '$direct'`.
  - **Added:** `utm_content [first touch]` / `utm_content [last touch]`
    and `utm_term [first touch]` / `utm_term [last touch]` are now
    surfaced in the per-event payload and registered as Mixpanel super-
    properties (previously omitted from the payload).

- **Session cookies renamed to `_pps` / `_ppsa`.** The cross-subdomain
  session ID and last-activity timestamp now live in `_pps` and
  `_ppsa` cookies (was `pp_analytics_session_id` /
  `pp_analytics_last_activity`). The leading underscore is the
  conventional "internal" marker and the short, opaque names are less
  inviting for users or third-party scripts to inspect or tamper with.
  Established users carrying the previous names are migrated
  transparently on the next read via the new
  `PersistentValueOptions.legacyCookieNames` field on
  `createPersistentValue`; the legacy cookies are deleted after a
  successful migration. `clear()` wipes legacy residue too.

- **`configure()` signatures use `DeepPartial<T>`.** All module
  `configure()` methods (analytics, braze, datalayer, ecommerce, event-
  source, login, mixpanel, vwo, voucherify, common/attribution, common/
  event-properties-builder, common/consent) now accept `DeepPartial<T>`
  instead of `Partial<T>`. Callers can override a single nested field
  without restating the full sub-config — matches what the runtime
  `createExtend` already does. Backward-compatible: anything assignable
  to `Partial<T>` is assignable to `DeepPartial<T>`. The new type is in
  `src/types/utility.types.ts`.

- **Shared `SdkSecurityOptions` interface.** Braze and Mixpanel SDK
  configs now extend a single shared interface (in `utility.types.ts`)
  for `integrity` / `crossOrigin` / `requireIntegrity`. Removes ~30
  lines of duplicated JSDoc; future loaders adopting SRI extend the
  same interface for coherence.

- **Voucherify fetch timeout.** `VoucherifyRetryConfig.requestTimeoutMs`
  (default `8000`) wraps each fetch attempt in an `AbortController` so
  a slow Voucherify response can't stall checkout. Retries still apply
  on timeout; set to `0` to opt out of the controller (legacy behavior).

- **Debounce dedup.** Three parallel inline debounce implementations in
  `braze/events.ts`, `braze/forms.ts`, `braze/purchases.ts` replaced
  with the shared `createDebounceTracker` from `common/debounce.ts`.

- **febpt-variant.ts hardened.** Hardcoded Webflow CMS selectors are
  now in a `DEFAULT_CONFIG` overridable via `window.__ppFebptVariant`
  before script load. The 15s observer timeout now `console.warn`s the
  unmatched selectors so CMS class renames surface instead of failing
  silently. Style tag has an id and is de-duplicated on repeated
  invocation.

- **Cross-module integration tests.** New `tests/integration/`
  directory with three files exercising real IIFE bundles in shared
  jsdom — ecommerce → mixpanel + dataLayer, braze SRI fail-closed +
  consent, voucherify timeout + baseline fallback. Locks in the
  cross-module behaviors that unit-test mocks can hide.

- **Shared retry primitives** in `src/common/retry.ts`:
  - `pollUntil({ check, intervalMs, maxAttempts, onMaxAttempts?, win? })`
    — cancellable setInterval-based polling. Replaces four duplicated
    poll loops in `analytics`, `attribution`, `mixpanel` VWO bridge, and
    `vwo` experiment-tracking.
  - `withRetryAsync({ fn, attempts, baseDelay, shouldRetry?, win? })`
    — promise-based exponential backoff retry. Now powers the
    `voucherify` fetch retry; the AbortController timeout stays in
    `fetchOnce` so each retry attempt gets its own deadline.

- **`addInteractionListener` helper** in `src/common/dom-events.ts`
  consolidates the `click + touchend` pair previously duplicated across
  braze, ecommerce, event-source, and datalayer modules. Single call
  with a `passive` flag (default `true`); returns a `remove()` handle
  for caller-controlled teardown.

- **Codebase-wide TypeScript modernization.** Migrated all `var` → `let`/
  `const` (635 replacements across 28 files; only the vendored Mixpanel
  SDK loader stub retains `var` for vendor-contract reasons). Replaced
  ~180 `any` / `Record<string, any>` annotations with `unknown` /
  `Record<string, unknown>` plus appropriate type guards. Public API
  surfaces (`AnalyticsAPI`, `BrazeAPI`, `DataLayerAPI`, `EventSourceAPI`)
  now use `Record<string, unknown>` for property bags. The 27 remaining
  `any` instances are all inside vendored third-party SDK loader stubs.

- `ppLib.Security.json.parse` and `ppLib.SafeUtils.get` gained literal-
  type-widening overloads so `SafeUtils.get(o, 'key', '')` returns
  `string` (not the literal `''`) without an explicit type annotation.

- `ppLib.Storage.get` is now generic (`<T = unknown>`) so callers can
  pass a target type: `Storage.get<TrackedParams>('first_touch')`.

- Window vendor globals (`window.mixpanel`, `window.braze`,
  `window._vwo_exp`, `window._vwo_code`) are now typed via narrow
  `MixpanelGlobal` / `BrazeGlobal` / `VwoExperiment` / `VwoCodeGlobal`
  interfaces instead of bare `any`.

### Test infrastructure

- Test count grew from 1792 (pre-modernization) to 2101 (current).
- 100% line coverage maintained across the SDK without `/*! v8 ignore */`
  workarounds for the new code.

---


## [3.6.1] — 2026-05-22

Post-merge Principal review of the v3.6.0 dual-instance Mixpanel
rollout surfaced four correctness gaps and a small set of code-quality
items. All fixes are backward-compatible — no migration required.

### Security

- **Consent gate widened to every PII-emitting Mixpanel op.** Pre-fix
  the gate covered only `track`; `identify`, `alias`, `register`,
  `register_once`, `opt_in_tracking`, and all of `people.*` (set,
  set_once, increment, append, union, track_charge) bypassed it. With
  `ppLib.consent.revoke()` (or `pp_consent: 'denied'`), calls like
  `identify('user@example.com')` or `people.set({ email, phone })` were
  still emitting PII to Mixpanel. The new rule, encoded as a
  `consentGated` flag on the dispatcher's `OP_TABLE`: any op that
  emits or stores PII is gated; ops that REDUCE data
  (`unregister`, `people.unset`) or are operator-controlled lifecycle
  actions (`reset`, `opt_out_tracking`) bypass the gate. `opt_in_tracking`
  is gated too — flipping opt-in under denied consent is incoherent;
  `opt_out_tracking` stays ungated so operators can always opt out.

- **Boot-time guard against same-token dual-write.** Nothing validated
  that `primary.token !== secondary.token` at boot. A same-token
  misconfig would silently double-write to one Mixpanel project,
  doubling billing and ingest volume, and corrupting Mixpanel's
  identity-merge semantics (two writes with the same `$device_id` to
  the same project produce a single profile with double event counts).
  `ppLib.mixpanel.init()` now logs a loud error and disables secondary
  in this case so the SDK keeps primary-only behavior and data
  integrity is preserved.

### Changed

- **Analytics `Mixpanel.send({ type: 'register' })` routes through the
  dispatcher.** Pre-fix it wrote directly to `window.mixpanel.register`,
  bypassing the dual-instance facade and silently dropping super-props
  on secondary. Any module using the analytics → Mixpanel bridge for
  super-prop registration (e.g. campaign params, AB-test exposure)
  would break dual-instance parity. Now routes through
  `ppLib.mixpanel.register` (fans out); the direct `win.mixpanel.register`
  fallback is retained for minimal deployments where the mixpanel
  module isn't loaded — mirroring the existing track-branch pattern.

- **`initOptions` reserved-key denylist.** Caller-supplied
  `initOptions.loaded` (a documented passthrough field on
  `MixpanelInstanceConfig.initOptions`) would silently overwrite the
  orchestrator's loaded callback, breaking the entire boot chain:
  identity-sync never runs, the pre-init queue never drains, and the
  15s watchdog fires with no recovery path. Six orchestrator-owned keys
  are now denylisted with a per-key warn: `loaded`,
  `cross_subdomain_cookie`, `opt_out_tracking_by_default`,
  `track_pageview`, `api_transport`, `api_host`. Non-reserved keys
  (`persistence_name`, `debug`, `property_blacklist`, etc.) still pass
  through unchanged.

- **Watchdog actually force-drains buffered events.** Pre-fix the 15s
  watchdog called `drainIfReady()` which is gated on "all enabled
  instances loaded" — meaning when one instance was stuck (the exact
  failure mode the watchdog is supposed to rescue), the pre-init queue
  stayed buffered forever, even though the log message claimed
  "force-drained". New `drainToReady()` + a `force` flag on
  `DispatchOptions` allow partial fan-out: events reach instances that
  DID load while the stuck one stays empty. The watchdog log now
  distinguishes three states: (a) force-drained N events to ready
  instance(s), (b) no instance ready → events stay queued, (c) stuck
  but idle.

- **Identity sync uses a single primary-then-mirror writer.**
  `unifyDistinctIdWithPpDistinctId` (run during boot's
  `registerSharedContext` pass) previously dispatched `identify` to
  both instances by default, even though secondary's identity is
  already being mirrored from primary by `syncIdentityFromPrimary` in
  the loaded-callback chain. Two writers to secondary's identity made
  future identity edits hard to reason about. Now: unify identifies
  primary only, then calls `resyncAfterReset()` to mirror to
  secondary — single canonical primary-then-mirror path reviewable in
  one place (`src/mixpanel/shared-context.ts`).

- **`resolveMpRef` renamed to `getOrAdoptMpRef` (impurity flag).** The
  function does either a pure read (when `state.mpRef` is set) OR an
  adoption with side effects (writes `state.mpRef` and
  `state.initialized` when promoting a globally-installed Mixpanel
  handle). Old name implied a pure resolve; new name makes the
  side-effect path visible at call sites.

- **Alias guard warn when no target is enabled.**
  `OP_TABLE.alias` defaults to `instances: ['primary']` (Simplified ID
  Merge projects don't use alias). After a future cutover that flips
  `primary.enabled: false`, alias would silently no-op. Now logs a warn
  with remediation guidance.

- **Loader stub tagged with `_ppStub: true`.** `getOrAdoptMpRef`
  previously couldn't distinguish the loader's queueing stub from the
  real Mixpanel SDK — both have a `.track` function. Adopting the stub
  would make the watchdog drain "succeed" into a queue that only
  drains when the real SDK loads. The stub is now tagged and explicitly
  skipped during adoption.

### Test infrastructure

- 16 new tests across `tests/mixpanel/boot-resilience.test.ts`,
  `tests/integration/mixpanel-data-correctness.test.ts`, and added
  coverage in `dual-instance.test.ts` + `dual-instance-coverage.test.ts`
  for the widened consent gate.
- Full suite: 2334 / 2334 passing (was 2314 at v3.6.0). Each fix
  shipped with its tests in the same merge.

## [3.6.0] — 2026-05-21

### Added

- **Dual-instance Mixpanel support — primary + secondary fan-out.**
  Powers the migration from PocketPills' old Mixpanel project
  (Original ID Merge) to the new project (Simplified ID Merge,
  configured server-side in Mixpanel's Project Settings → Identity
  Merge). During the validation window both projects receive identical
  events with shared `$device_id` and `distinct_id` so parity
  dashboards can validate the new project before cutover.

  **Public API** (`window.ppLib.mixpanel`):

  ```ts
  ppLib.mixpanel = {
    // Functional core — dual-write to every enabled instance by default.
    track, identify, register, register_once, unregister, alias,
    reset, opt_in_tracking, opt_out_tracking,
    people: { set, set_once, increment, append, union, unset, track_charge },

    // Pass { instances: ['primary'] } as the trailing options arg to
    // restrict any call to one instance.

    // Namespaced sugar — single-instance scope, same surface.
    primary: { ...same ops + setEnabled / isEnabled / getConfig },
    secondary: { ...same },

    // Lifecycle.
    configure(DualMixpanelConfig | LegacyMixpanelConfig),
    init(), setEnabled(name, bool), getConfig(),
  };
  ```

  **Config shape:**

  ```ts
  ppLib.mixpanel.configure({
    primary:   { enabled: true,  token: 'PRIMARY_TOKEN',   projectName: 'OldProject' },
    secondary: { enabled: true,  token: 'SECONDARY_TOKEN', projectName: 'NewProject' },
    shared:    { sessionTimeout: 1800000, cookieNames: {...}, ... },
  });
  ```

  **Legacy back-compat:** `configure({ token: '...' })` still works —
  synthesized into `{ primary: { token: '...' }, secondary: { enabled:
  false } }`. Existing single-instance callers see no behavior change.

- **HOF dispatcher** (`src/mixpanel/dispatch.ts`) — every Mixpanel op
  routes through one primitive with consent gating, enrichment, and
  per-instance error isolation. Adding a new op is a one-line entry in
  `OP_TABLE`. A primary throw never blocks secondary and vice versa.

- **`alias` defaults to primary-only routing** — Simplified ID Merge
  projects don't use legacy alias-to-merge semantics. Callers can
  override via `{ instances: ['secondary'] }`.

- **Identity sync — `$device_id` pinning.** Secondary's `loaded`
  callback runs `syncIdentityFromPrimary` BEFORE any tracks fire,
  pinning secondary's `$device_id` to primary's. Without this, named
  Mixpanel instances each generate their own UUIDs, making cross-
  project parity for anonymous events impossible.

- **Shared `SessionManager`** — one canonical session ID fans out via
  `dispatch('register')` to every enabled instance so both projects
  report identical session boundaries.

- **Single SDK script injection** — the vendored Mixpanel loader stub
  is injected exactly once regardless of how many instances run. SRI /
  nonce / `cdnUrl` apply to the one script and live in the shared
  config (per-instance overrides not supported by design).

- **Watchdog (15s)** — if either enabled instance fails to report
  `loaded` (network failure, ad-blocker, SRI mismatch), the buffered
  pre-init queue is rescued so events aren't silently swallowed. The
  drain logic was hardened in v3.6.1.

- **Cookie migration is primary-only** — secondary is a fresh project
  with no legacy cookies to migrate. Per-token sessionStorage flag
  (`pp_mp_migrated_<token>`) prevents primary/secondary state sharing.

- **Bypass-path rewiring (same release):** `src/vwo/index.ts`,
  `src/analytics/index.ts`, `src/ecommerce/index.ts`,
  `src/event-source/index.ts` previously wrote directly to
  `window.mixpanel.*` — silently primary-only. They now route through
  `ppLib.mixpanel.*` (fan-out), with fallbacks retained for minimal
  deployments where the mixpanel module isn't included.

### Test infrastructure

- Test count grew from 2245 (pre-dual-instance) to 2314.
- New test surfaces: `tests/mixpanel/dual-instance.test.ts` (35 IIFE
  behavior tests), `tests/mixpanel/dual-instance-coverage.test.ts`
  (17 native-import coverage tests),
  `tests/integration/dual-mixpanel-parity.test.ts` (5 end-to-end
  parity tests asserting identical event names + property bags +
  distinct_ids across both instances for a 10-event mixed sequence).
- Mixpanel module coverage: ~89% (per-module varies; bundle coverage
  ~93% lines / ~85% branches).

### Cutover runbook

See [Dual-instance Mixpanel architecture](https://github.com/Pocketpills-marketing/pp-web-sdk/blob/main/src/mixpanel/README.md)
in-repo, or the architectural memo at `src/mixpanel/`:

1. Both `primary` and `secondary` enabled, parity dashboards run for
   ≥1 week.
2. Config-only PR flips `primary.enabled: false` after validation.
3. After a week of secondary-only operation, drop the `primary` config
   block. Optional internal rename `secondary` → `primary` is a
   separate refactor (no public API change since callers use
   `ppLib.mixpanel.track()` not `ppLib.mixpanel.primary.track()`).

## How to read this file

Each entry above is in one of four buckets:

- **BREAKING** — Migrate before adopting this version.
- **Security** — A behavior change that resolves a security finding.
- **Added** — New capabilities. Adopt at your discretion.
- **Changed** — Internal cleanup. May still affect callers that depend on
  exact log shapes / error types / config defaults.

Before publishing a release tag, this `## Unreleased` section is renamed
to `## [N.M.P] — YYYY-MM-DD` and a fresh empty `## Unreleased` is added.
