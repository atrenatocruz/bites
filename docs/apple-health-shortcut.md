# Building the "Bites Health" Shortcut

The owner builds this once on an iPhone and shares it as an iCloud link. Everyone else only adds it from Bites Settings.

Name the Shortcut exactly **Bites Health**. The app runs it with `shortcuts://run-shortcut?name=Bites%20Health`, so a different name breaks the Sync buttons.

## What it sends

`POST https://bites-api.wellbites.workers.dev/api/activity/sync`, header `Authorization: Bearer <key>`, JSON body:

```json
{
  "days": [
    { "day": "2026-10-14", "restingKcal": 1712, "activeKcal": 412,
      "workouts": [{ "type": "Running", "start": "2026-10-14T07:10:00+01:00", "minutes": 42, "kcal": 410 }] }
  ]
}
```

- One entry per day, for today and the 6 days before (7 in total; the API accepts up to 8).
- Set every number field in the Dictionary actions to the **Number** type. The API also reads text like `412,5` or `1,712`, but Number avoids surprises.
- A day with no samples can send `0` or leave the value empty. Bites treats 0 resting energy as "not measured" (no Apple Watch) and estimates it from the profile, and it never replaces a day it already has with an empty one, so a run while the phone is locked does no harm.

## Actions, in order

1. **Text** — leave it empty. This is where the import question puts the person's key. Then **Set Variable** `Key`.
2. **Repeat** 7 times. Inside the repeat:
   1. **Calculate** `Repeat Index` − `1` → **Set Variable** `Back`.
   2. **Adjust Date**: `Current Date`, Subtract `Back` days. Then **Adjust Date**: Get Start of Day → **Set Variable** `DayStart`.
   3. **Adjust Date**: `DayStart`, Add `1` day → **Set Variable** `DayEnd`.
   4. **Format Date** `DayStart`, Date Format Custom `yyyy-MM-dd` → **Set Variable** `DayKey`.
   5. **Find Health Samples** where Type is **Active Energy** and Start Date is between `DayStart` and `DayEnd`, with **Group By: Day** turned on. Grouping makes Health return the day's total with overlapping sources (Watch plus iPhone, or a workout app that also writes energy) counted once, like the Health app does. Summing the raw samples instead can count the same energy twice. If the result is a list, take the first item. **Set Variable** `Active`.
   6. Same for Type **Resting Energy** → **Set Variable** `Resting`.
   7. **Find Health Samples** where Type is **Workouts**, same dates. Then **Repeat with Each** item:
      - **Get Details of Health Sample** → Type. **Set Variable** `WType`.
      - **Get Details of Health Sample** → Start Date, then **Format Date** ISO 8601 (include time). **Set Variable** `WStart`.
      - **Get Details of Health Sample** → Duration, converted to minutes. **Set Variable** `WMin`.
      - **Get Details of Health Sample** → Value (energy, kcal). **Set Variable** `WKcal`.
      - **Dictionary** with keys `type` = `WType`, `start` = `WStart`, `minutes` = `WMin`, `kcal` = `WKcal`. **Add to Variable** `Workouts`.
   8. **Dictionary** with `day` = `DayKey`, `restingKcal` = `Resting`, `activeKcal` = `Active`, `workouts` = `Workouts` (set this value's type to Array). **Add to Variable** `Days`.
   9. **Set Variable** `Workouts` to nothing, so the next day starts empty.
3. **Dictionary** with `days` = `Days` (type Array).
4. **Get Contents of URL** `https://bites-api.wellbites.workers.dev/api/activity/sync`:
   - Method **POST**, Request Body **JSON**, using the dictionary from step 3.
   - Header `Authorization` = `Bearer ` followed by the `Key` variable (one space after Bearer).
5. **Get Dictionary Value** `ok` from the result. **If** it is `1`/true: **Show Notification** "Bites: synced ✓". **Otherwise**: **Get Dictionary Value** `message` from the result and **Show Notification** "Bites: " + `message` (every error from the API carries a readable message; if there is none, the server could not be reached, so show "Bites: couldn't sync, try again later").

If **Workouts** is not offered as a Health sample type on your iOS version, skip step 2.7 and leave `workouts` as an empty list. Bites then shows energy and the deficit, with "No workouts".

## Before sharing

1. Shortcut details (ⓘ) → **Privacy**: allow the Health types and the connection to `bites-api.wellbites.workers.dev`, so it does not ask on every run.
2. Shortcut details → **Setup** (Import Questions): add a question for the empty Text in step 1, worded "Paste your Bites key".
3. Run it once yourself with your own key (see below) and check the notification says "Bites: synced ✓".
4. **Share → Copy iCloud Link**, and send the link to the developer. It becomes `VITE_HEALTH_SHORTCUT_URL` in the web build, which makes the Connect button appear for everyone.

## Getting your own key before the button is live

The developer gives you a preview build of Bites. In it, open Settings → Apple Health → Connect Apple Health. The key is copied (or shown with a Copy button); paste it into the empty Text action from step 1.

## Checking the numbers

Compare a past day in Bites (Diary → Activity → Burned) with the Health app (Active Energy + Resting Energy for that day). They should match to within rounding. If Bites shows clearly more, the energy is being summed per sample instead of grouped by day (step 2.5).
