# Ensemble Web — Vercel Deploy Checklist

Living document. Run through this before any production deploy, especially
before demos, interviews, or after significant schema changes.

---

## Pre-Deploy (Run Local)

### 1. Verify local state is clean

```cmd
git status
```

- [ ] All intended changes committed
- [ ] No `.bak` or temp files tracked
- [ ] `.env` is NOT in the staged or tracked files (should be in `.gitignore`)

### 2. Verify TypeScript compiles

```cmd
npx tsc --noEmit
```

- [ ] Zero errors reported
- [ ] Zero warnings about missing types

If errors appear, fix them locally first. Vercel will fail the build on
the same errors.

### 3. Verify Prisma schema is consistent

```cmd
npx prisma validate
npx prisma migrate status
```

- [ ] Schema validates
- [ ] No pending migrations on local database
- [ ] Migration directory structure is clean (no orphaned files)

### 4. Verify lint passes

```cmd
npm run lint
```

- [ ] Zero errors
- [ ] Warnings reviewed (warnings don't block deploy, but worth knowing)

### 5. Local smoke test

```cmd
npm run dev
```

- [ ] App starts without errors
- [ ] `/settings` loads
- [ ] `/chat` loads
- [ ] Aimee and Arthur both respond when messaged
- [ ] "How [Name] Pushes Back" settings tab populates

### 6. Push to GitHub

```cmd
git push origin master
```

- [ ] Push succeeds
- [ ] Commit appears in the EnsembleWeb repo on GitHub

---

## Vercel Configuration (One-Time Setup / Verify)

### Environment Variables

In Vercel project settings → Environment Variables, confirm each of the
following is set for Production:

**Required for app to function:**

- [ ] `DATABASE_URL` — Neon Postgres connection string (must include
  `?sslmode=require` for Neon)
- [ ] `DIRECT_URL` — Neon direct connection (for Prisma migrations, not
  pooled)

**LLM providers (at least one required):**

- [ ] `OPENROUTER_API_KEY`
- [ ] `GEMINI_API_KEY`
- [ ] `ANTHROPIC_API_KEY` (if using direct Claude)
- [ ] `OPENAI_API_KEY` (if using direct OpenAI)

**TTS:**

- [ ] `ELEVENLABS_API_KEY` (optional — app falls back to browser speech
  synthesis if missing)

**Anti-sycophancy configuration:**

- [ ] `ANTI_SYCOPHANCY_MODE` = `warn` or `rewrite` (defaults to `warn` if
  unset)

**What should NOT be set on Vercel:**

- `OLLAMA_URL` — Vercel can't reach your LAN. Any Ollama references in
  `CharacterConfig` will fall through to the global provider chain.

### Build Settings

- [ ] Framework Preset: Next.js
- [ ] Build Command: `prisma generate && prisma migrate deploy && next build`
- [ ] Output Directory: `.next` (default)
- [ ] Install Command: `npm install` (default)
- [ ] Node.js Version: 20.x or higher

### Domain / URL

- [ ] Production URL confirmed (typically `ensemble-web-foo.vercel.app`
  or custom domain)
- [ ] SSL certificate active (green lock in browser)

---

## Deploy

### Option A: Auto-deploy on push

If Vercel is connected to the GitHub repo with auto-deploy enabled, the
push in step 6 triggered a build automatically. Check the Vercel
dashboard for build progress.

### Option B: Manual deploy

In the Vercel dashboard, click the project, then "Deploy" button on the
latest commit.

---

## Post-Deploy Verification

### 1. Watch the build log

- [ ] Build completes without errors
- [ ] Prisma migrations apply cleanly (look for "Applied migration" lines)
- [ ] No "missing environment variable" warnings
- [ ] Final build step shows "Compiled successfully"

**Common failure modes:**

- **Prisma migration error** — run `npx prisma migrate resolve` locally
  to fix state, then redeploy
- **Missing env var at build time** — add it in Vercel settings and
  redeploy
- **TypeScript error** — fix locally, commit, push (avoid "ignore
  errors" flags unless absolutely needed)

### 2. Hit the deployed URL in a browser

- [ ] Landing page loads
- [ ] `/settings` loads
- [ ] `/chat` loads without errors in browser console
- [ ] 3D avatar renders (Aimee and Arthur GLB models served correctly
  from `/public`)

### 3. Test conversation

- [ ] Send message to Aimee → she responds
- [ ] Response is coherent (not an error message)
- [ ] Avatar animates / lip-syncs if voice is wired
- [ ] Switch to Arthur → he responds
- [ ] Both characters use their configured models (check response style)

### 4. Test anti-sycophancy layers

- [ ] Send: "That's a great idea, right?" — expect pushback, not
  validation
- [ ] Check Vercel Functions logs for `[anti-sycophancy]` log entries
  (detection events)
- [ ] Click the "You're just agreeing with me" button on a response →
  expect "Got it" confirmation

### 5. Test memory + honesty dashboard

- [ ] Complete one full conversation (5-10 messages)
- [ ] Open `/settings` → "How [Name] Pushes Back" tab
- [ ] Dashboard populates with stats
- [ ] Metrics show expected categories (Too agreeable, You called it out,
  Caught saying, etc.)

### 6. Test per-character provider routing

- [ ] Aimee's configured provider is used (check response speed /
  characteristics vs Arthur's)
- [ ] Provider tier warning appears in settings if high-sycophancy
  model is selected

### 7. Smoke test tools

- [ ] Ask Aimee to search the web — tool call fires, results integrated
- [ ] Ask Aimee to fetch a URL — tool call fires

---

## Known Limitations on Vercel

Document these so you're not surprised:

- **No Ollama access.** Any character wired to `provider: 'ollama'` will
  fall through to the global provider chain. For the cloud demo, use
  cloud providers only.
- **No Chatterbox TTS.** Local TTS sidecar is unreachable. ElevenLabs or
  browser speech synthesis is the only TTS path.
- **Ephemeral filesystem.** Anything written to disk during a request
  is lost. All state MUST go to Neon (it does, but verify any new
  features preserve this).
- **Serverless function timeout (Vercel default: 10-30s).** Long-running
  AI calls may hit this. Streaming is preferred; non-streaming providers
  (OpenRouter, Gemini) with large responses may timeout on complex
  queries. Set `maxDuration` in route files if needed.
- **Compression uses whichever provider has a key.** Ollama-URL-based
  compression is unavailable; OpenRouter or Gemini acts as the compressor.
  Compression is best-effort — if it fails, session falls back to hard
  reset.

---

## Pre-Demo / Pre-Interview Ritual

Run this BEFORE the meeting starts:

1. **T-60 min:** Hit the deployed URL, verify landing page loads
2. **T-30 min:** Run through one full conversation with Aimee including
   a tool call and a memory injection. Confirm "How [Name] Pushes Back"
   dashboard shows stats
3. **T-15 min:** Refresh the URL in a fresh browser window. Verify zero
   console errors in DevTools
4. **T-10 min:** Close all other tabs / applications that might compete
   for bandwidth during the demo
5. **T-5 min:** Open the URL in the tab you'll present from. Verify
   Aimee responds to one quick "hello"

If anything fails at any step:

- Check Vercel Functions logs for errors
- Check the Vercel deployment list for a recent failed build
- Fallback plan: demo against localhost on your laptop (`npm run dev`)
  with a screen-share — less impressive URL but the app still works

---

## Rollback (If Needed)

If a deploy breaks something mid-demo or shortly after:

1. In Vercel dashboard, go to Deployments
2. Find the last known-good deployment
3. Click the three-dot menu → "Promote to Production"
4. Rolled back in ~30 seconds, no rebuild needed
5. Diagnose what broke in local dev, commit fix, push, redeploy

---

## Vercel Quirks Worth Knowing

- **Edge vs Serverless functions.** Most of Ensemble's routes are
  serverless functions (Node runtime). Don't accidentally mark them as
  Edge — Prisma doesn't work in Edge runtime.
- **Cold starts.** First request after idle takes 1-3 seconds longer
  than subsequent requests. Warm up before demoing by hitting the URL
  a few times.
- **Caching.** Vercel aggressively caches static assets. If you update
  a GLB model and don't see it on prod, hard-refresh (Ctrl+Shift+R) or
  redeploy.
- **Preview deployments.** Every branch push creates a preview URL.
  Useful for testing changes without affecting production.

---

## Where Things Live

| Thing | Where |
|-------|-------|
| Production URL | Vercel dashboard → project → Domains |
| Build logs | Vercel dashboard → Deployments → [deployment] → Build Logs |
| Runtime logs | Vercel dashboard → Logs (live stream) or Functions tab |
| Environment variables | Vercel dashboard → Settings → Environment Variables |
| Database | Neon dashboard (separate from Vercel) |
| Source of truth | GitHub `BoldPhoenix/EnsembleWeb` |

---

## Last Updated

2026-04-12 — initial checklist drafted alongside Phase 1-5 anti-sycophancy
implementation. Update as deploy patterns evolve.
