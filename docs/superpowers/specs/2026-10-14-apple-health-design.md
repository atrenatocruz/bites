# Apple Health (Activity and Calorie Deficit) — Design Spec

Date: 2026-10-14 · Status: approved in conversation, awaiting written review

## 1. Goal and context

Bites knows what people eat. Apple Health knows what they burn. This feature brings the two together so each person can see, per day:

- whether they trained (workouts from Apple Health), and
- their **real calorie deficit**: energy burned (resting + active, from Apple Health) minus energy eaten (Bites).

Bites is a web app (PWA), and Apple Health has no web access. The bridge is an **Apple Shortcut** that reads Health on the iPhone and sends daily totals to the Bites API.

**Requirement from the user: setup must be easy.** Connecting is one button, one paste, and an optional nightly automation with a guide.

Out of scope for now: Android (Health Connect has no web access; a native wrapper may follow), Strava/Garmin, editing the calorie target from burned energy ("earn calories back"), steps, weight sync, heart rate.

## 2. Deficit definition (decided: approach A)

`deficit = (restingKcal + activeKcal) − eatenKcal`

- Shown as its own number next to the existing ring. The existing target and ring (target − eaten) do not change.
- Positive: a deficit (shown in the accent/good colour). Negative: shown as "+N surplus" in the over colour.
- **No Health data for the day**: no deficit is shown. Never a made-up number.
- **Resting energy missing but active energy present** (no Apple Watch): resting falls back to the profile BMR (`bmr()` in `shared/src/nutrition.ts`) and the burned number is marked "estimated".
- **Today**: labelled "so far", since Health and meals are still changing.
- Rejected alternatives: adding workout calories to the day's target (MyFitnessPal style), and doing both.

## 3. User experience

### 3.1 Setup (Settings → Apple Health → Connect)

The Apple Health section only appears on iOS (iPhone/iPad user agent). Elsewhere it reads "Apple Health is only available on iPhone for now."

1. **Connect Apple Health** calls `POST /api/activity/key`, receives a new personal key, and copies it to the clipboard. The copy is started inside the tap with a `ClipboardItem` whose content is the pending key, because iOS refuses clipboard writes made after an `await`. If copying fails, the key is shown with a Copy button.
2. The section shows "Key copied ✓" and an **Add the Shortcut** button linking to the shared iCloud Shortcut (`VITE_HEALTH_SHORTCUT_URL`). iOS shows **Add Shortcut**.
3. The Shortcut has one import question, "Paste your Bites key". The person pastes and taps Add Shortcut.
4. Back in Bites, the section switches to a "Finish setup" state with **Sync now**, which opens `shortcuts://run-shortcut?name=Bites%20Health`. On first run the Shortcut asks for Health permission (iOS shows the categories), then sends the last 7 days and shows "Bites: synced ✓".
5. Optional card **Sync automatically every night**: a short numbered guide in a sheet (Shortcuts → Automation → + → Time of Day → 23:00, Daily → Run Immediately → Bites Health). Also suggests a second automation "When a workout ends" where available.

The section considers itself "connected" once the server has received at least one sync for this person.

### 3.2 Settings states

| State | Shows |
| --- | --- |
| Not connected | One-line explanation, **Connect Apple Health** |
| Key created, no sync yet | "Finish setup": **Sync now**, **Show my key again** (creates a new key, invalidating the old one), help text |
| Connected | "Last synced: today 23:00", **Sync now**, **Set up nightly sync** (guide), **Disconnect** |
| Not iOS | "Only available on iPhone for now" |

**Disconnect** deletes the key (`DELETE /api/activity/key`). Synced days stay until they expire. The existing "Delete all data" flow also deletes the key and all activity data.

### 3.3 Diary

A new **Activity** card directly under the day card, shown only once the person is connected:

- Top line: **Burned 2 650 · Ate 2 100 · Deficit 550** (or "+200 surplus"). "so far" on today, "estimated" when resting energy fell back to BMR.
- Workouts of the day, one row each: icon by type, type name, start time, duration, kcal. Example: "🏃 Run · 07:10 · 42 min · 410 kcal". No workouts: "No workouts".
- Footer: "Synced today 23:00". When the last sync is more than 24 hours old, a **Sync** button (same `shortcuts://` link).
- Day without Health data: "No Health data for this day."

Week strip and month calendar: a small dot under days that have at least one workout.

### 3.4 Trends

Two extra stats for the selected period (week / month / year):

- **Avg deficit** (per day), over days that have both Health data and at least one logged meal (a day with no meals would otherwise count its whole burn as deficit). Shows "–" when there are none.
- **Workouts** (count), over all days with Health data.

Hidden when the person is not connected.

### 3.5 Language and units

All strings in en and pt-PT. Energy follows the profile unit (kcal or kJ) via the existing `formatEnergy`. The Shortcut always sends kcal.

## 4. Architecture

### 4.1 Data (worker KV, existing `RATE_KV` namespace)

| Key | Value | TTL |
| --- | --- | --- |
| `actkey:<sha256(key)>` | `uid` | none |
| `actkeyof:<uid>` | `sha256(key)` (so a new key replaces the old one) | none |
| `activity:<uid>:<YYYY-MM>` | `{ days: Record<"YYYY-MM-DD", ActivityDay> }` | 400 days |
| `activity:<uid>:last` | `{ syncedAt: number, tz: string }` | 400 days |

```ts
interface Workout { type: string; start: string /* ISO 8601 */; minutes: number; kcal: number | null }
interface ActivityDay { restingKcal: number | null; activeKcal: number | null; workouts: Workout[] }
```

Grouping days by month keeps reads cheap: the Diary's range is at most 27 KV reads, a sync touches at most 2 months. Only the hash of the key is stored. The key is 32 random bytes, base64url.

Privacy: the worker stores only daily energy totals and workout type/time/duration/kcal. No heart rate, location or routes.

### 4.2 Worker endpoints

| Route | Auth | Behaviour |
| --- | --- | --- |
| `POST /api/activity/key` | Firebase | Creates a key, replaces any previous one, returns `{ key }` once. |
| `DELETE /api/activity/key` | Firebase | Deletes the key (both KV entries). |
| `DELETE /api/activity` | Firebase | Deletes the key and all `activity:<uid>:*` entries (used by "Delete all data"). |
| `GET /api/activity?from=YYYY-MM-DD&to=YYYY-MM-DD` | Firebase | Returns `{ days: Record<day, ActivityDay>, lastSync: { syncedAt, tz } \| null, hasKey: boolean }`. Range at most 800 days (the Diary loads two to three calendar years at once). |
| `POST /api/activity/sync` | `Authorization: Bearer <key>` | Body `{ tz, days: [{ day, restingKcal, activeKcal, workouts }] }`. Validates, merges each day into its month (overwriting that day), updates `last`. Returns `{ ok: true, days: n }`. |

New routes live under `/api/activity` because `/api/health` is already the uptime check.

Validation for `sync`:
- At most 8 days; each `day` a valid date within the last 10 days and not more than 1 day in the future.
- Energy numbers `null` or 0–20 000; workouts at most 20 per day, `minutes` 0–1 440, `kcal` `null` or 0–10 000, `type` trimmed to 40 characters.
- Body capped at 64 KB. `tz` is optional (Shortcuts cannot read the IANA zone name); kept when `Intl.DateTimeFormat` accepts it, otherwise stored as `"UTC"`. It is informational only.
- Numbers may arrive as strings, including a decimal comma (pt-PT phones); they are parsed leniently.
- Unknown or deleted key: 401. Rate limit: 30 syncs per key per hour (existing `ratelimit.ts` pattern), then 429.
- CORS: unchanged except adding `DELETE` to the allowed methods. The Shortcut sends no `Origin` header, so it needs no CORS.

Handlers follow the existing style: functions in a new `worker/src/activity.ts` with injected `verifyRequest` and `now`, routed from `index.ts`.

### 4.3 The Shortcut ("Bites Health")

Built once by the owner on an iPhone from a written recipe (`docs/apple-health-shortcut.md`, part of the implementation), then shared as an iCloud link. Behaviour:

- Import question: the key, stored in a Text action.
- Repeat for each of the last 7 days (today included): find Health samples of Active Energy and of Resting Energy for that day and sum them; find that day's workouts (type, start, duration, energy).
- Build the JSON body with the device time zone and day keys in local time, and POST it to `https://bites-api.wellbites.workers.dev/api/activity/sync` with the Bearer key.
- Show a notification: "Bites: synced ✓", or the error message from the API.

The exact Shortcuts actions for workouts are confirmed while building it. If workouts cannot be read with the available actions, the first version ships with energy only and the Activity card hides the workout list.

### 4.4 Web app

- `lib/activity.ts`: API calls (`createKey`, `deleteKey`, `fetchActivity`), iOS detection, the `shortcuts://` run URL, and pure helpers: `deficitFor(day, eatenKcal, profile)` returning `{ burned, deficit, estimated }` or `null`.
- `features/diary/ActivityCard.tsx`, workout dots in `WeekStrip` and `MonthCalendar`, two stats in `Trends`.
- `features/settings/HealthSection.tsx` (keeps `SettingsSheet` from growing) and `features/settings/HealthGuide.tsx` for the nightly-sync guide.
- Data loading: the Diary fetches activity for the visible range when the person is connected, caches the last response in localStorage for offline use, and refetches when the app comes to the foreground (so returning from the Shortcut shows new data).
- New build var `VITE_HEALTH_SHORTCUT_URL` (the iCloud link). While it is empty, the Connect button is hidden.

## 5. Error handling

- **Never synced / automation not set**: the Activity card shows the last sync time and a Sync button; 7-day resends fill gaps.
- **Key lost or Shortcut deleted**: Show my key again / Connect creates a new key; the old one stops working.
- **Shortcut gets 401** (disconnected): its notification says to reconnect from Bites Settings.
- **Offline app**: shows cached activity; Connect and Sync now show the offline message.
- **Clipboard blocked**: the key is shown on screen with a Copy button.
- **Partial Health data** (only some days or only active energy): stored as `null` per field; the deficit rules in section 2 apply.

## 6. Testing

Worker (Vitest, existing style), `worker/test/activity.test.ts`:
- Key create/replace/delete; only the hash is stored; old key returns 401 after replacement.
- Sync validation (day window, caps, body size, bad tz), month bucketing across a month boundary, overwrite of a resent day, `last` update, rate limit.
- GET range across months, range cap, auth required; DELETE removes everything.

Web (Vitest + Testing Library):
- `deficitFor`: normal day, surplus, missing resting energy (BMR fallback, estimated), no data, today "so far".
- ActivityCard states: connected with workouts, no workouts, no data, stale sync shows Sync.
- HealthSection states: not iOS, not connected, key created, connected; Connect copies the key and opens the link; Disconnect.
- Trends stats count only days with data. Locale files have every new key in both languages (existing `locales.test.ts`).

Manual (owner, on iPhone): build the Shortcut from the recipe, connect, sync, check the Diary numbers against the Health app for a few days, set up the nightly automation.

## 7. Rollout

1. Worker endpoints deployed first (no visible change).
2. Owner builds the Shortcut from the recipe, shares it, and the iCloud link goes into `VITE_HEALTH_SHORTCUT_URL`.
3. Web deployed with the link; the Connect button appears.

This feature is independent of the reminders plan and can be built before or after it; both only add keys to `RATE_KV`.
