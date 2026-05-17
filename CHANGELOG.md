# Changelog

All notable changes to **pp-web-sdk** are documented here. The project follows
[Semantic Versioning](https://semver.org/) — breaking changes require a major
or, at minimum, a documented migration path in this file.

## Unreleased

This section tracks changes that have landed on `main` but have not yet
been published behind a version tag. Breaking changes are flagged
**BREAKING** and include migration notes.

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

## How to read this file

Each entry above is in one of four buckets:

- **BREAKING** — Migrate before adopting this version.
- **Security** — A behavior change that resolves a security finding.
- **Added** — New capabilities. Adopt at your discretion.
- **Changed** — Internal cleanup. May still affect callers that depend on
  exact log shapes / error types / config defaults.

Before publishing a release tag, this `## Unreleased` section is renamed
to `## [N.M.P] — YYYY-MM-DD` and a fresh empty `## Unreleased` is added.
