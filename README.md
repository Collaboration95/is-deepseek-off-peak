# is-deepseek-off-peak

A single-file site that shows whether DeepSeek API pricing is off-peak right now, with a live countdown to the next switch.

Every displayed time follows the timezone picker, which starts at **UTC+8**. UTC is shown alongside for reference because DeepSeek defines the schedule in UTC.

## Launch

Open `index.html` in a browser (double-click it), or serve it:

    python3 -m http.server 8000

then visit http://localhost:8000. No build step, no dependencies, no network calls at runtime.

## Timezone picker

The control in the header sets the display timezone as a plain UTC offset and re-times the whole page: the large clock, the countdown and switch line, the "your day at a glance" strip, the next-switch list and the schedule line in the footer.

- every whole hour from UTC-12 to UTC+14
- the real-world half-hour and quarter-hour zones: UTC-9:30, UTC-3:30, UTC+3:30, UTC+4:30, UTC+5:30, UTC+5:45, UTC+6:30, UTC+8:45, UTC+9:30, UTC+10:30, UTC+12:45, UTC+13:45

The pick is remembered per browser (localStorage key `deepseek-off-peak:utc-offset`); an unrecognised or out-of-range value falls back to UTC+8. A constant offset is exact here because the schedule repeats daily and the offsets never carry DST.

Changing the offset only moves where the local day starts. The price changes stay pinned to 01:00, 04:00, 06:00 and 10:00 UTC, so at UTC-10 for example the local day runs off-peak 00:00-15:00, peak 15:00-18:00, off-peak 18:00-20:00, peak 20:00-24:00.

## Design

Light "engineering paper" look: a warm off-white page carrying a hairline grid that fades out past the fold, near-black display type with tight tracking, monospace for every number, label and caption, and a single yellow accent for the picker.

| Element | How it is built |
| --- | --- |
| Paper grid | Two 1px `linear-gradient` layers at 46px intervals on `body::before`, dimmed by a `radial-gradient` mask so it fades toward the edges |
| Warm wash | `body::after` with a white and a yellow-tinted radial gradient behind the headline |
| Display type | Heavy system stack at `clamp(35px,7.2vw,58px)` with `letter-spacing:-.035em` and `line-height:0.99` |
| Numerals | `font-variant-numeric:tabular-nums` everywhere a value changes, so the countdown never shifts sideways |
| Framed board | White card with a yellow border, an 8px yellow halo ring and a warm drop shadow |
| State colours | `body[data-state]` swaps a trio of semantic tokens (ink, soft background, border) that the dot, countdown, bar, chips and strip all read |

The stats row states the invariants outright: 17h off-peak and 7h peak per day hold at every offset, and the longest unbroken off-peak run inside one local day ranges from 7h30m (UTC+6:30) to 15h (UTC-10).

Type is set in system faces so the page still makes no network requests, which also keeps it fast where Google Fonts is slow or blocked. To match the reference more closely, drop a webfont in: `Inter Tight` for `--font-display` and `JetBrains Mono` for `--font-mono` are the closest free equivalents, and self-hosted `.woff2` files keep the offline guarantee.

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

Runs ~388k assertions that re-derive the schedule independently of the page code:

- every second of a UTC day, plus every boundary instant at +/-1ms
- a full month minute by minute (exactly 17h off-peak / 7h peak daily, weekends included)
- the billing windows behind the progress bar, including the 15-hour window that crosses midnight
- the default UTC+8 base: offset exactness, 09:00/12:00/14:00/18:00 flips, midnight rendering as 00:00, and weekday rollover
- the picker: every offered offset is a unique quarter hour in range, offset labels render as UTC+5:30 / UTC-9:30 style, and the picker cannot be set to a non-existent zone
- every offset the picker offers: clocks re-derived from a shifted UTC instant, the day strip checked against the UTC schedule every five minutes, and exactly 17h off-peak in each local day
- the footer schedule sentence regenerated from the same segments, which is also asserted to match the text the page ships with
- the longest-run stat against a minute-by-minute sweep of the same local day, per offset

The results are identical under any host timezone (TZ=America/New_York node verify.mjs gives the same pass as TZ=UTC).
