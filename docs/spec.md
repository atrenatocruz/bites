# Bites — Product & Design Spec

> Point. Snap. Know.  ·  Aponta. Fotografa. Sabe.

Bites is a calorie tracker PWA. You point the camera at food, the AI breaks the plate into ingredients with grams and calories, you confirm, and your day fills up. Three tabs, no clutter.

## 1. Design philosophy — "Steve Jobs mode"

- **One thing per screen.** Every screen has a single primary action. Scanner → shoot. Result → save. Diary → see today.
- **Say no to 1,000 things.** No social feed, no recipes, no badges zoo, no ads, no water tracker, no weight log (v1). Calories + macros only.
- **Content is the interface.** Big numbers, real food photos, almost no chrome. No borders where whitespace will do. No icons with labels where an icon alone is clear.
- **Defaults that are right.** Scanner opens first. Meal type is guessed from the time. Portions are pre-filled. The user only corrects.
- **Delight in motion, never in decoration.** Spring physics on sheets and rings, subtle haptics (`navigator.vibrate(10)` on capture/save where supported). No gradients-for-the-sake-of-it, no glassmorphism overload.
- **Honest.** AI estimates show confidence; we never pretend precision we don't have.

## 2. Visual system

### Brand
- **Name:** Bites. Wordmark set in the system font, weight 700, tracking −0.03em, lowercase-free: `Bites`.
- **Logo mark:** a filled circle (a plate / a cookie) with **one bite taken out** of the top-right — a concave semicircle cut. Single color. Works at 16 px. Built as SVG with a mask (`/web/public/logo.svg`).
- **App icon:** the bite-circle in white on the accent color, iOS-style rounded square (maskable safe-zone 80%).

### Color tokens (CSS variables, light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#000000` | page |
| `--bg-elevated` | `#F5F5F7` | `#1C1C1E` | cards, sheets |
| `--fg` | `#1D1D1F` | `#F5F5F7` | primary text |
| `--fg-secondary` | `#6E6E73` | `#98989D` | secondary text |
| `--separator` | `#E5E5EA` | `#38383A` | hairlines |
| `--accent` | `#FF5A1F` | `#FF6A33` | Bites orange: shutter, primary buttons, kcal ring |
| `--protein` | `#0A84FF` | `#409CFF` | protein ring/bar |
| `--carbs` | `#FFB800` | `#FFC933` | carbs ring/bar |
| `--fat` | `#AF52DE` | `#BF5AF2` | fat ring/bar |
| `--good` | `#34C759` | `#30D158` | on-target day |
| `--over` | `#FF9F0A` | `#FFB340` | over-target day |

Only one accent. Macro colors appear only in macro visuals.

### Typography
System stack only (SF Pro on Apple, Roboto/Segoe elsewhere): `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif`. Numbers use `font-variant-numeric: tabular-nums`.
| Style | Size/line | Weight |
|---|---|---|
| Large Title | 34/41 | 700 |
| Title | 22/28 | 700 |
| Headline | 17/22 | 600 |
| Body | 17/22 | 400 |
| Subhead | 15/20 | 400 |
| Caption | 12/16 | 500, `--fg-secondary` |
| Hero number (kcal) | 56/60 | 700, tabular, tracking −0.02em |

### Layout & motion
- 8-pt grid. Screen gutter 20 px. Card radius 20 px, sheet radius 28 px, buttons fully rounded (pill) height 52 px.
- Respect `env(safe-area-inset-*)`. Tab bar 64 px + inset, background `--bg` at 85% with `backdrop-filter: blur(20px)` (the only blur in the app).
- Motion via framer-motion springs: `{ type: "spring", stiffness: 400, damping: 34 }` for sheets; rings animate `pathLength` over 0.8 s ease-out. Honour `prefers-reduced-motion` (cross-fades only).
- Icons: `lucide-react`, stroke 1.75.

## 3. Screens

### 3.1 Splash (every cold start, ≤ 1.2 s; first run continues to onboarding)
White (or black) screen. The circle scales in from 0.8 → 1 with a spring; at 400 ms a bite is "taken" (mask circle animates in at top-right) with a tiny haptic; at 700 ms the wordmark `Bites` fades up beneath. Then cross-fade to the app. Skippable by tap. Reduced motion: static logo for 500 ms.

### 3.2 Onboarding (first run only)
**Slides (3, swipe or "Continue"):** full-bleed, a single illustration, one line of title, one line of body, pagination dots, pill button.
1. **"Point. Snap. Know."** / "Aponta. Fotografa. Sabe." — *Your camera knows what's on your plate.* Illustration: phone frame over a plate, scanning line.
2. **"Every ingredient, counted."** / "Cada ingrediente, contado." — *Bites splits your meal into parts you can adjust.* Illustration: plate with floating labels "Rice 150 g · 195 kcal", "Chicken 120 g · 198 kcal".
3. **"Your day at a glance."** / "O teu dia num relance." — *A calendar that shows how you're doing.* Illustration: ring + week strip.

**Questions (4, one per screen, big tappable options, progress bar on top):**
1. Goal: Lose / Maintain / Gain.
2. Sex (Female/Male, used only for BMR) + birth year (wheel/number input).
3. Height (cm) + weight (kg) — live BMI line under the inputs.
4. Activity: Sedentary / Light / Moderate / Very active (one-line description each).

**Your plan:** hero number = daily kcal target (counts up), macro split row (P/C/F grams), "Edit" link, pill "Start" and secondary "Save with Google" (hidden when Firebase not configured). Footnote: *AI estimates can be off by 20–40%. Adjust portions for accuracy.*

### 3.3 Tab bar
Three items: **History** (left, `list` icon), **Scan** (center, 56 px accent circle with `scan` icon, raised), **Diary** (right, `calendar` icon). Labels under side icons only. App opens on **Scan**.

### 3.4 Scan (center)
- Full-screen live camera (`facingMode: environment`). Dimmed corners, a rounded-square viewfinder outline. Caption above shutter: *Include a fork or your hand for scale.*
- Bottom row: gallery (left) · shutter (center, 76 px white ring) · "Type" (right, `pencil` icon) for text description.
- Small "Add detail" chip above the shutter opens a one-line input (e.g. "no sauce", "half portion") sent as `hint`.
- On capture: freeze frame, shutter animation, a soft shimmer sweeps the photo with copy *Analyzing…* / *A analisar…*.
- Camera denied/unavailable: calm empty state with "Choose photo" and "Type it" buttons.
- **Result sheet** (slides up over the frozen photo, draggable):
  - Title (meal_title), meal-type pill (tappable: Breakfast/Lunch/Dinner/Snack).
  - Hero kcal + range caption ("between 520 and 690").
  - Three small macro rings P / C / F with grams.
  - Item list: name + assumption caption, grams stepper (−/+ by 10 g, tap number to type), kcal at right. Confidence < 0.5 shows a small "?" dot.
  - If `follow_up_question`: a card with the question and a text field + "Update" (re-analyses with the answer as hint).
  - Not food: friendly message + "Try again".
  - Buttons: primary pill **Save** · text button **Retake**.
  - Save → sheet collapses into the Diary tab icon (shared-layout animation), haptic, toast "Added to today".

### 3.5 History (left)
Large title "History". Search field. Sections by day ("Today", "Yesterday", "Mon 12 Oct") with day total at right. Rows: 52 px rounded thumbnail, title, time · meal type, kcal right. Tap → detail sheet (same editor as Result, plus Delete and "Log again today"). Swipe-left to delete (with undo toast). Empty state: logo + "Your scans will show up here."

### 3.6 Diary (right) — the heart
- Large title = selected date ("Today" / "Wed, 14 Oct"), settings gear top-right.
- **Week strip**: 7 days, each a mini ring (progress to target) with weekday letter; swipe for previous weeks; selected day filled. Tap the title to expand a **month calendar** (grid of mini rings; color: `--good` within ±10% of target, `--over` above, `--separator` empty; 🔥 streak count in the header).
- **Day card**: big ring (kcal eaten / target, accent color), center shows "remaining" number; three macro progress bars below.
- **Meals of the day** grouped by meal type, same rows as History.
- **Trends** section: segmented control `Week | Month | Year`.
  - Week / Month: bar chart of daily kcal with dashed target line.
  - Year: bar per month = average daily kcal.
  - Stats row (3 small cards): Average/day · Days on target · Streak (current / best).

### 3.7 Settings (sheet from Diary gear)
Daily target & macros (editable), profile (re-run questions), language (System / Português / English), units (kcal / kJ), account (Sign in with Google / Sign out; anonymous badge), Export CSV, Export JSON, Delete all data (destructive confirm), About (version, AI disclaimer).

## 4. AI

- Model: `claude-sonnet-5-5` (configurable via `AI_MODEL` env var on the Worker).
- Call shape: `client.beta.messages.create` with `system` (cached), user content = image (base64 JPEG) + text, `output_config: { effort: "medium", format: { type: "json_schema", schema } }`, server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`), `max_tokens: 16000`. No `temperature` (rejected on this model), no forced `tool_choice` (rejected on this model). Check `stop_reason === "refusal"` and `max_tokens` before parsing.
- The Worker validates the JSON, clamps numbers, recomputes item kcal sanity and the meal totals; it never trusts the model's sums.
- Expected cost ≈ $0.015–0.025 per scan (~$2–3/month at 4 scans/day).

The exact system prompt and schema live in `worker/src/prompt.ts` and `worker/src/schema.ts` (see the implementation plan, Task 3).

## 5. Data

Two interchangeable repositories behind one interface (`web/src/lib/repo/types.ts`):
- **LocalRepo** (IndexedDB via `idb`) — used when Firebase env vars are absent; also great for dev.
- **FirebaseRepo** (Firestore + Auth anonymous/Google, offline persistence) — used when `VITE_FIREBASE_*` are set.

Firestore layout: `users/{uid}` profile, `users/{uid}/meals/{id}`, `users/{uid}/days/{dayKey}` aggregates. Rules: owner-only.

## 6. Non-goals (v1)
Barcode scanning, water/weight tracking, social, recipes, Apple Health / Google Fit sync, paywall, push notifications.
