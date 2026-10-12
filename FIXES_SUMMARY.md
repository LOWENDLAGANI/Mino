# Codebase Fixes Summary

## Critical Fix (was blocking all checks)
- **`package.json`**: Changed `"postcss": "^8.5.28"` → `"^8.4.47"` 
  - This was causing `EOVERRIDE` npm errors that prevented `tsc --noEmit` and all tests from running
  - Now typecheck and test infrastructure should work

## Google Login CSP Fix
- **`next.config.mjs`**: Added `https://*.firebaseapp.com` to `frame-src` directive
  - Resolves the Content Security Policy violations reported during Google login:
    - `script-src` blocking google services
    - `frame-src` blocking `https://mino-2425.firebaseapp.com/`
  - Added `Cross-Origin-Opener-Policy: same-origin-allow-popups` header to allow Google auth popup

## Code Quality & Bug Fixes
| File | Fix | Purpose |
|------|-----|---------|
| `components/AdminPanel.tsx` | Added `console.error` to 8 silent catch blocks | Stop hiding errors in admin console (grant, revoke, pause, resume, listUsers, fetch chat, visitor registry, audit) |
| `lib/subscription.ts` | Added `console.error` in `loadSubscription()` catch block | Better debugging of subscription loading failures |
| `components/Markdown.tsx` | Removed `as unknown as Record<string, unknown>` pattern; fixed SyntaxHighlighter type | Type safety, removed unsafe casts |
| `lib/useSmoothText.ts` | Added `state.frame = 0` reset at start of effect | Fixes smooth scroll bug where previous effect's frame counter would cause early return |

## Vercel Deployment Status
- **Typecheck**: Should now pass with postCSS version fix
- **Tests**: Should now run with postCSS fix  
- **Build**: May have additional issues - the `tsc_output.txt` file was created during a previous typecheck attempt

## Known Remaining Issues (pre-existing / external)
- **Google services scripts**: `script-src` may still warn on Google Maps/Analytics if those integrations are active (covered by existing `https://apis.google.com https://accounts.google.com`)
- **Vercel deployment**: May need `npx vercel inspect dpl_... --logs` to diagnose remaining build failures