# is-deepseek-off-peak

A single-file site that shows whether DeepSeek API pricing is off-peak right now, with a live countdown to the next switch.

All comparisons are in **UTC+8** (fixed, no DST), which is the base timezone for every displayed time. UTC is shown alongside for reference because DeepSeek defines the schedule in UTC.

## Launch

Open `index.html` in a browser (double-click it), or serve it:

    python3 -m http.server 8000

then visit http://localhost:8000. No build step, no dependencies, no network calls at runtime.

## Schedule it shows

DeepSeek's schedule is identical every day. Off-peak is billed at 50% off peak rates.

| UTC+8 window | UTC window | Billing |
| --- | --- | --- |
| 00:00-09:00 | 16:00-01:00 | Off-peak (50% off) |
| 09:00-12:00 | 01:00-04:00 | Peak |
| 12:00-14:00 | 04:00-06:00 | Off-peak (50% off) |
| 14:00-18:00 | 06:00-10:00 | Peak |
| 18:00-24:00 | 10:00-16:00 | Off-peak (50% off) |

That is 17 hours off-peak and 7 hours peak per day. The price changes on exact UTC instants, so in UTC+8 each day flips at 09:00, 12:00, 14:00 and 18:00.

Note that UTC+8 midnight is not a price change. The off-peak stretch from 18:00 to 09:00 is a single 15-hour billing window that spans it, which is why the progress bar runs 18:00 to 09:00 rather than resetting at midnight.

Schedule source: DeepSeek API docs, Models & Pricing (https://api-docs.deepseek.com/quick_start/pricing/); this schedule took effect 16 Aug 2026.

## Verify

    node verify.mjs

Runs ~364k assertions that re-derive the schedule independently of the page code:

- every second of a UTC day, plus every boundary instant at +/-1ms
- a full month minute by minute (exactly 17h off-peak / 7h peak daily, weekends included)
- the billing windows behind the progress bar, including the 15-hour window that crosses midnight
- the UTC+8 base: offset exactness, 09:00/12:00/14:00/18:00 flips, midnight rendering as 00:00, and weekday rollover
- a per-minute sweep of the base day under seven different offsets, each checked against the UTC schedule

The results are identical under any host timezone (TZ=America/New_York node verify.mjs gives the same pass as TZ=UTC).
