# Bites

> Começar (em português) — ver a secção [Começar](#começar) logo a seguir.

## Começar

Bites é uma app para contar calorias: apontas a câmara para o prato, a IA estima os ingredientes e as calorias, e ajustas as gramas se for preciso. Funciona como PWA (instala-se no ecrã principal do telemóvel).

Para experimentar no teu computador:

1. `npm install`
2. `cp worker/.dev.vars.example worker/.dev.vars` (já vem com `MOCK_AI=1`, por isso não gasta dinheiro nem precisa de chave da Anthropic, e com `AUTH_MODE=off`, para o servidor local não exigir login)
3. `npm run dev` e abre o endereço indicado no terminal.
4. No telemóvel a câmara só funciona com HTTPS: corre `npx cloudflared tunnel --url http://localhost:5173` e abre o endereço `https://...` que aparecer.

Para pôr online, segue as secções "Setup guides" abaixo (Anthropic, KV, Firebase, Cloudflare Pages).

**Importante antes de publicar:** `worker/wrangler.toml` já vem com `AUTH_MODE = "firebase"`; só tens de pôr `FIREBASE_PROJECT_ID = "o-teu-projeto"`. O modo `AUTH_MODE=off` só existe em `worker/.dev.vars` (desenvolvimento local). Com `AUTH_MODE = "off"` o servidor confia num identificador de dispositivo enviado pelo cliente, e qualquer pessoa consegue contornar o limite diário de scans (e gastar a tua chave).

---

## What is Bites

Bites is a calorie tracker PWA. Point the camera at a meal and Claude estimates each ingredient, its grams and its calories. You adjust portions, save the meal, and see your day in a calendar with a ring, macros and trends. It is bilingual (English and European Portuguese), works offline for everything except scanning, and keeps your data on the device (or in your own Firestore when you sign in).

Monorepo (npm workspaces):

| Package | What it is |
| --- | --- |
| `shared/` | Types, schemas and the calorie/macro maths shared by both sides |
| `worker/` | Cloudflare Worker: `POST /api/analyze` calls Claude, validates the output, rate limits per user per day |
| `web/` | Vite + React PWA |

## Local development

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # MOCK_AI=1 returns canned results, no API key needed; AUTH_MODE=off skips Firebase auth locally
npm run dev                                    # worker on :8787, web on :5173 (proxies /api)
```

Open the LAN URL that Vite prints. Phones only allow the camera on HTTPS, so tunnel it:

```bash
npx cloudflared tunnel --url http://localhost:5173
```

To call the real model locally, put a real `ANTHROPIC_API_KEY` in `worker/.dev.vars` and remove `MOCK_AI=1`.

Checks:

```bash
npm test
npm run typecheck
npm run build -w web
```

## Production configuration (read this first)

> **Warning: `worker/wrangler.toml` defaults to `AUTH_MODE = "firebase"`; production must keep it and set `FIREBASE_PROJECT_ID`.**
> `AUTH_MODE = "off"` is for local development only and lives in `worker/.dev.vars` (copied from `.dev.vars.example`), never in `wrangler.toml`. It trusts a device id supplied by the client, so anyone can send a new id with every request and bypass the daily scan limit, running up your Anthropic bill. With `AUTH_MODE = "firebase"` the Worker verifies the Firebase ID token and rate limits by the verified user id.

```toml
[vars]
AI_MODEL = "claude-sonnet-5-5"
AUTH_MODE = "firebase"
FIREBASE_PROJECT_ID = "your-firebase-project-id"
DAILY_LIMIT = "30"
ALLOWED_ORIGINS = "https://your-app.pages.dev"
```

`ALLOWED_ORIGINS` is a comma separated list of web origins allowed to call the API (localhost origins are always allowed for development).

## Setup guides

### 1. Anthropic API key

Create a key at <https://console.anthropic.com>, then store it as a Worker secret (never commit it):

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
```

### 2. Rate limit storage (Workers KV)

```bash
cd worker
npx wrangler kv namespace create RATE_KV
npx wrangler kv namespace create RATE_KV --preview
```

Paste the printed ids into `kv_namespaces` in `worker/wrangler.toml` (`id` and `preview_id`).

### 3. Firebase

1. Create a project in the [Firebase console](https://console.firebase.google.com).
2. Authentication: enable the **Anonymous** and **Google** providers.
3. Firestore: create a database in production mode.
4. Project settings, add a Web app, and copy its config into `web/.env`:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

   Without these variables the app stores everything locally in the browser.
5. Keep `AUTH_MODE = "firebase"` and set `FIREBASE_PROJECT_ID` in `worker/wrangler.toml` (see the warning above).
6. Deploy the security rules (they only let a user read and write their own `users/{uid}` data):

   ```bash
   npx firebase-tools deploy --only firestore:rules --project <your-project-id>
   ```

7. In Authentication, Settings, Authorized domains, add your Pages domain.

### 4. Deploy the Worker

```bash
cd worker
npx wrangler deploy
```

Note the URL, e.g. `https://bites-api.<you>.workers.dev`.

### 5. Deploy the web app (Cloudflare Pages)

Create a Pages project from this repository with:

- Build command: `npm run build -w web`
- Build output directory: `web/dist`
- Environment variables: `VITE_API_URL=https://bites-api.<you>.workers.dev` plus the `VITE_FIREBASE_*` values from `web/.env`

Add the resulting `https://<project>.pages.dev` origin to `ALLOWED_ORIGINS` and redeploy the Worker.

## Cost

Each scan costs roughly **$0.015 to $0.025** with `claude-sonnet-5-5` (image input plus a structured JSON answer). At 4 scans a day that is about **$2 to $3 per month**. The daily limit (`DAILY_LIMIT`) caps the worst case per user.

Setting `AI_MODEL = "claude-haiku-5-5"` in `worker/wrangler.toml` costs about **20x less**, but estimates are less accurate, especially for mixed plates and portion sizes.

AI estimates can be off by 20 to 40 percent. Bites is not medical advice.

## PWA and iOS notes

- Installable PWA with a service worker (auto update) and Apple splash screens. Regenerate icons and splash images from `web/public/logo-icon.svg` with `npm run icons -w web`; the generator also writes landscape splash images, which are not referenced and can be deleted.
- The camera `<video>` uses `playsinline muted autoplay`, so scanning works from the iOS home screen.
- Offline: a banner appears, and the scan buttons show a message instead of calling the API. Browsing and editing saved meals keeps working.

## Project layout

```
shared/   types, zod schemas, nutrition maths
worker/   Cloudflare Worker (src/, test/, wrangler.toml)
web/      PWA (src/features/*, src/lib/repo/{local,firebase}.ts)
docs/     design spec
```

## Plans

Scans are limited per user per day and the model depends on the plan:

| Plan | Model | Daily scans |
| --- | --- | --- |
| Free (default) | Cloudflare Workers AI, `@cf/meta/llama-4-scout-17b-16e-instruct` | `FREE_DAILY_LIMIT` (5) |
| Paid | Claude (`AI_MODEL`) | `DAILY_LIMIT` (30) |

The plan lives in KV as `plan:<firebase uid>`; any value other than `paid` means free. Until payments exist, switch a user by hand:

```bash
npx wrangler kv key put "plan:<uid>" paid --binding RATE_KV --remote   # upgrade
npx wrangler kv key delete "plan:<uid>" --binding RATE_KV --remote     # back to free
```

### Upgrade codes

Settings shows a **Plan** section with an "Upgrade with a code" field for free users. A valid code sets `plan:<uid>` to `paid` for good. Codes are stored only as SHA-256 hashes (lowercase, trimmed) in `REDEEM_CODE_HASHES` in `worker/wrangler.toml`, comma separated. Each user gets 10 guesses a day.

```bash
printf 'my-new-code' | sha256sum   # add the hex to REDEEM_CODE_HASHES
```

Once a user has unlocked Premium (by code, or by being set to `paid`), Settings shows a **Use Premium** toggle to switch between the free and paid plan; accounts that never unlocked it only see the code field. Unlocking is remembered as `unlocked:<uid>` in KV.
