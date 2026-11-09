# L06 — Mobile and PWA

The production build uses `@vitejs/plugin-legacy` 8.2.4 with the launch plan's exact browser targets. `renderModernChunks: false` serves a single, split SystemJS build to supported browsers. The default modern output injects a `data:text/javascript` feature probe, which conflicts with Nuqta's self/hash script policy. No `data:` script source, `unsafe-inline` script permission, or `unsafe-eval` was added. This choice increases the modern-browser payload; QR decoding is loaded only when the cashier opens the camera.

`packages/domain/src/browser-policy.ts` pins the package's four inline hashes. Vite checks package hashes against that file and Caddy, then hashes every generated inline script during build. API and Caddy use matching script policies. Local HTTP disables Helmet's HTTPS-upgrade directive because Safari also upgrades loopback assets; staging/production keep HTTPS requirements.

The UUID compatibility path uses secure randomness. Controls fall back to body portals without native Popover or ResizeObserver, including controls inside keyboard-managed dialogs. The camera requests the rear-facing stream, uses muted/playsInline video, and releases tracks on hide, unmount, decode success or error, including permission resolving after the page was hidden. Returning to the page does not reopen the camera automatically.

## Installation, caching and updates

`manifest.webmanifest` starts at `/customer` in standalone mode, with Arabic/RTL metadata and the specified blue theme. Icons are a placeholder N mark, pending an owner-approved Nuqta logo. `writeNuqtaIcons` reproduces the 180/192/512/maskable PNG assets.

The service worker caches only the versioned public shell and explicitly allowlisted assets. It does not cache API, auth, health, private exports, logos from API routes, query-bearing asset requests, or mutation responses. API and health responses use HTTP `no-store` as well. Offline navigation can open the shell and a reconnect message; it cannot read cached customer data or record a purchase. A failed API connection also raises the reconnect state when the browser incorrectly reports `navigator.onLine=true`. Reconnection refreshes the session without treating network loss as logout.

Updates install in the background and wait for the user to tap Update now. Only then does the worker activate and reload. First installation does not display a false update prompt. The worker retains at most the current shell and one previous shell. Missing static assets return 404 instead of HTML. Static shell caches contain no personalized HTML.

## Repeatable local checks

Run `npm run build`, then `npm run test:e2e:mobile`, or run the complete `npm run verify:local`. Tests use an ephemeral loopback port, built assets with the API CSP, and synthetic users in `nuqta_local`/`nuqta_ci`; they refuse the manual demo database. Browser contexts are isolated. Reports and screenshots are generated in `docs/execution/evidence/implementation/`.

- Chromium Pixel 5 and WebKit iPhone 12: real enrollment, customer card, manual cashier stamp, actual updated balance, Arabic/English, zero unexpected script-policy violations or page errors.
- Compatibility APIs are intentionally absent during those journeys. An owner select is tested by touch and inside a dialog using the fallback portal.
- Chromium synthetic camera stream proves constraints, video flags, track cleanup on hide/late permission and no automatic resume. It does not prove hardware camera quality or QR decoding in low light.
- Public shell opens offline, API fetch fails offline, API responses never enter CacheStorage, a waiting update reloads on user action, and the authenticated card survives reconnection/update.
- Small SE/Pixel/S8 viewports: Arabic/English login screenshots, horizontal overflow and 44px button checks. Historical SE/S8 Playwright descriptors have unsupported iOS10/Android7 UAs; the tests keep their viewport sizes with supported iOS15/Android8 UAs. This is layout emulation, not a physical legacy-browser test.
- Unsupported iOS12 UA receives the update-browser screen. An unapproved inline script is blocked by CSP.

Lighthouse's PWA audit is deprecated ([Chrome documentation](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest)). The test records Chrome DevTools `Page.getInstallabilityErrors` and requires an empty result, plus the service-worker/manifest checks above. This is not a fabricated Lighthouse score.

CI installs Chromium and WebKit and runs the mobile suite after the desktop suite. External CI execution remains unverified without a Git remote. Physical iPhone/Android camera, installation and old OS tests remain owner/device gates in L08. Docker/Caddy runtime validation remains pending the local Docker engine repair or a real host.
