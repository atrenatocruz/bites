# Reminders — Design Spec

Date: 2026-10-14 · Status: approved in conversation, awaiting written review

## 1. Goal and context

Bites is used by a small group of friends and family. The goal of this feature is to bring people back every day with two kinds of push notification:

- **Meal reminders** for breakfast, lunch and dinner, sent only if that meal has not been logged yet today.
- **A daily summary** in the evening: today's calories against the target.

Success: people who turn reminders on keep logging meals, without being nagged about meals they already logged.

Out of scope for now: streak-at-risk reminders, weekly summary, water tracking, social features. They may follow later.

## 2. User experience

### 2.1 Onboarding

A new **Reminders** step appears after the camera step, only when push can work: the app runs from the home screen (`isStandalone()`) and the browser supports `Notification` and `PushManager`. In a normal browser tab it is skipped, because iOS only allows web push for installed web apps (iOS 16.4+).

The step shows the suggested times and two actions:

| Reminder | Default time |
| --- | --- |
| Breakfast | 09:00 |
| Lunch | 13:00 |
| Dinner | 20:30 |
| Daily summary | 21:30 |

- **Turn on reminders** calls `Notification.requestPermission()` from the tap (required on iOS), subscribes with `pushManager.subscribe`, and saves the settings with the defaults above.
- **Not now** skips and remembers the choice (`bites.reminders.dismissed` in localStorage), like the install and camera steps.
- If permission is denied, the step explains how to re-enable notifications in the phone settings and lets the person continue.
- Redoing the questions from Settings never shows this step.

### 2.2 Settings

A **Reminders** section with:

- A master switch (on/off for this device).
- One row per reminder (breakfast, lunch, dinner, summary) with its own switch and a time picker in 15-minute steps.
- States:
  - Not installed on iPhone: a note that the app must be added to the home screen first, linking to the install instructions.
  - Permission denied: how to re-enable notifications in the phone settings.
  - Unsupported browser: the section explains reminders are not available here.

Changing anything saves straight away (`PUT /api/reminders`).

### 2.3 Notifications

| Kind | When | Text (pt-PT example) | Tap opens |
| --- | --- | --- | --- |
| Meal | At the meal time, only if that meal type is not logged today | "🍽️ Hora do almoço — ainda não registaste o almoço. Tira uma foto!" | Scan |
| Summary, meals logged | At the summary time | "Hoje: 1 840 de 2 200 kcal — dentro da meta." (or "… acima da meta") | Diary |
| Summary, nothing logged | At the summary time | "Hoje ainda não registaste nada." | Diary |

- Language follows the profile locale (`pt-PT` or `en`; "system" resolves to the device language when settings are saved).
- Times are local to the person's time zone.
- Energy uses the profile unit (kcal or kJ).
- Snacks never cancel a meal reminder.

## 3. Architecture

Chosen approach: **the app reports a minimal daily status to the worker** (approach A). Rejected: having the worker read Firestore with an admin service account (more sensitive and complex), and blind reminders (would nag people who already logged, and could not show numbers).

### 3.1 Data (worker KV, existing `RATE_KV` namespace)

| Key | Value | TTL |
| --- | --- | --- |
| `push:<uid>` | `ReminderSettings` (below) | none |
| `day:<uid>:<YYYY-MM-DD>` (local date) | `{ logged: MealType[], kcal: number, target: number, units: "kcal" \| "kj", updatedAt: number }` | 48 h |
| `sent:<uid>:<YYYY-MM-DD>:<kind>` | `"1"` | 48 h |

```ts
type ReminderKind = "breakfast" | "lunch" | "dinner" | "summary";
interface ReminderSettings {
  tz: string;                       // IANA time zone, e.g. "Europe/Lisbon"
  locale: "pt-PT" | "en";
  reminders: Record<ReminderKind, { on: boolean; time: string }>; // "HH:MM", minutes a multiple of 15
  devices: { endpoint: string; keys: { p256dh: string; auth: string }; addedAt: number }[]; // max 3, newest kept
  updatedAt: number;
}
```

Privacy: the worker only ever sees which meal types were logged today and the day's totals. No dish names or photos. Daily records expire after 48 hours.

### 3.2 Worker endpoints (Firebase-authenticated, like `/api/plan`)

| Route | Body | Behaviour |
| --- | --- | --- |
| `GET /api/reminders` | – | Returns the settings without the device keys, plus whether this device's endpoint is registered (endpoint passed as a query parameter). |
| `PUT /api/reminders` | `{ tz, locale, reminders, device? }` | Validates and saves. Adds or replaces `device` by endpoint, keeping at most 3. |
| `DELETE /api/reminders` | `{ endpoint }` | Removes that device. Deletes `push:<uid>` when no devices are left. |
| `PUT /api/day` | `{ date, logged, kcal, target, units }` | Saves the daily status with a 48 h TTL. Rejects dates more than one day away from now. |

Validation: time strings must be `HH:MM` with minutes in {00, 15, 30, 45}. `tz` must be accepted by `Intl.DateTimeFormat`. `locale` must be `pt-PT` or `en`. Endpoints must be `https`. Request bodies are capped in size. The existing "Delete all data" flow also calls `DELETE /api/reminders` for this device and a new `DELETE /api/day` that removes the person's daily records.

### 3.3 Scheduler

- A cron trigger in `worker/wrangler.toml`: `*/15 * * * *`, handled by a `scheduled()` export.
- Each run lists `push:` keys and processes each person independently, so one failure never blocks the others.
- For each enabled reminder, it is **due** when its local time falls in the window `(now − 15 min, now]` in the person's time zone. If a run is missed, a reminder can still go out up to 1 hour late, never later.
- Skip when `sent:<uid>:<date>:<kind>` exists.
- Meal reminder: skip when `day:<uid>:<date>.logged` contains that meal type.
- Summary: build the text from the day record, or the "nothing logged" text when there is none.
- Send to every device. Mark `sent:` once at least one device accepted the message.
- Device responses `404` or `410` remove that device. Other failures are retried on the next run, within the 1-hour limit.

### 3.4 Sending (Web Push)

- Library: `web-push-neo` (Web Crypto and `fetch`, aes128gcm, depends only on `jose`, which the worker already uses). Its source and tests are reviewed before adoption. Fallback: `@pushforge/builder`.
- VAPID keys are generated once. `VAPID_PRIVATE_KEY` is a Cloudflare secret, `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (`mailto:` address) are worker vars, and the web app gets `VITE_VAPID_PUBLIC_KEY`.
- Payload JSON: `{ title, body, tab: "scan" | "diary", tag }`. `tag` is the kind plus the date, so a repeat replaces instead of stacking. TTL is 1 hour.

### 3.5 Web app

- **Service worker**: keep the generated Workbox service worker and add `importScripts: ["push-sw.js"]`. `public/push-sw.js` handles `push` (shows the notification with the app icon) and `notificationclick` (focuses an open window or opens `/?tab=scan|diary`).
- **Tab from URL**: on start, the app reads `?tab=` and opens that tab, then removes the parameter from the address.
- **`lib/reminders.ts`**: support detection, permission state, subscribe and unsubscribe, load and save settings, and `syncDay()`.
- **Daily status sync**: whenever meals change (`dataVersion` bumps) and on app start, the shell computes today's logged meal types and kcal from `repo.mealsForDay(today)` and calls `PUT /api/day`. It is debounced (about 2 seconds) and skipped when reminders are off, the app is offline, or the status has not changed since the last send.
- **Time zone refresh**: on start, if the device time zone differs from the saved one, the settings are re-saved.
- **UI**: `features/onboarding/RemindersScreen.tsx`, and a Reminders group in `SettingsSheet`. All strings in en and pt-PT.

## 4. Error handling summary

- **Offline logging**: the status reaches the worker once the app is back online. Until then, a reminder for an already-logged meal may slip through. This is accepted as the cost of approach A.
- **Permission revoked or app uninstalled**: the push service answers 404 or 410, and the device is removed.
- **Missed scheduler runs**: catch up within 1 hour, otherwise skip.
- **Invalid input to the endpoints**: 400 errors. Missing login: 401.
- **KV write volume**: one daily-status write per meal change, one `sent:` write per notification. This is well inside the free tier for a small group.

## 5. Testing

Worker (Vitest, existing style):
- Due-reminder calculation across time zones, a day boundary and a daylight-saving change.
- No duplicate sends. Logged meals are skipped. Summary text in both languages and both units.
- Expired devices are removed. One failing person does not stop the others.
- All four routes: validation, auth, 3-device cap, delete behaviour.

Web (Vitest + Testing Library):
- The onboarding step shows only when installed and supported, and handles allowed, denied and "not now".
- Settings: master switch, per-reminder switch, time change, and the not-installed and denied states.
- The daily status is sent after save, edit and delete. It is debounced and skipped when unchanged.
- `?tab=` opens the right tab.
- The push service worker shows the payload and routes the tap.

Manual, on a real iPhone with the app installed: turn reminders on, receive a meal reminder and the summary, tap each one, and confirm a meal reminder does not arrive once that meal is logged.

## 6. Rollout

1. Generate the VAPID keys and add the secret and vars (needs the owner's Cloudflare login).
2. Deploy the worker with the cron trigger, then the web app.
3. Verify on the owner's iPhone before telling friends and family.
