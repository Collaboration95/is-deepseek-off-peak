# is-deepseek-off-peak

A single page that shows whether DeepSeek API pricing is off-peak right now, with a live countdown to the next switch.

Check it [out](https://collaboration95.github.io/is-deepseek-off-peak/)

Off-peak rates are half of peak rates. Peak pricing only applies Monday through Friday, during 01:00–04:00 and 06:00–10:00 UTC; Saturday and Sunday are fully off-peak. Times follow the timezone picker, which starts at UTC+8; UTC is shown alongside.

## Run it

Open `index.html` in a browser. That is the whole page: one file, no build step, no dependencies, no network calls. To serve it over HTTP instead:

    python3 -m http.server 8000

## Timezone picker

The control in the header sets the display timezone as a plain UTC offset and re-times everything on the page: both clocks, the countdown, the day strip, the next-switch list and the footer sentence.

- every whole hour from UTC-12 to UTC+14
- the real half-hour and quarter-hour zones: UTC-9:30, UTC-3:30, UTC+3:30, UTC+4:30, UTC+5:30, UTC+5:45, UTC+6:30, UTC+8:45, UTC+9:30, UTC+10:30, UTC+12:45, UTC+13:45

The pick is remembered in `localStorage` per browser, and anything unrecognised falls back to UTC+8. Changing the offset only moves where the local day starts; the price changes stay pinned to UTC.

## Schedule

The schedule is defined in UTC and changes by weekday. The timezone picker changes how the current day and switch times are displayed; it does not move the billing windows or turn weekend peak pricing on.

| Days (UTC) | UTC | Billing |
| --- | --- | --- |
| Monday-Friday | 01:00-04:00 | Peak |
| Monday-Friday | 06:00-10:00 | Peak |
| Monday-Friday | 00:00-01:00, 04:00-06:00, 10:00-24:00 | Off-peak (50% off) |
| Saturday-Sunday | 00:00-24:00 | Off-peak (50% off) |

Each weekday has 17 hours off-peak and 7 hours peak. Each weekend day has 24 hours off-peak, so a full week has 133 off-peak hours and 35 peak hours. Source: [DeepSeek API docs — Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/), effective 16 Aug 2026.

## Layout

The page fits one screen: three bands in a viewport-height grid, with every vertical measure tied to viewport height so a short window compresses it rather than pushing content below the fold. Below 860px wide the two panels fuse into one card and the lede drops; on a short phone the headings, legend and captions around the strip stand down. The day strip and schedule sentence follow the selected local calendar day, including an all-off-peak weekend.

The dot beside the eyebrow pulses while the page is open: an expanding halo that fades, tinted with the current state colour, so it reads as a live indicator. It stands still under `prefers-reduced-motion`.

## Verify

    node verify.mjs

Runs an independent schedule model across weekday and weekend boundaries, a full month minute by minute, the long Friday-to-Monday off-peak window behind the progress bar, the picker's offsets and labels, and a sweep over every offered offset that checks clocks, the day strip and footer text against the UTC schedule. Results are identical under any host timezone.
