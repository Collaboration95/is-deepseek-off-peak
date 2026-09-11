# is-deepseek-off-peak

A single page that shows whether DeepSeek API pricing is off-peak right now, with a live countdown to the next switch.

Check it [out](https://collaboration95.github.io/is-deepseek-off-peak/)

Off-peak is 50% off peak rates. Times follow the timezone picker, which starts at UTC+8; UTC is shown alongside.

## Run it

Open `index.html` in a browser. That is the whole page: one file, no build step, no dependencies, no network calls. To serve it over HTTP instead:

    python3 -m http.server 8000

## Timezone picker

The control in the header sets the display timezone as a plain UTC offset and re-times everything on the page: both clocks, the countdown, the day strip, the next-switch list and the footer sentence.

- every whole hour from UTC-12 to UTC+14
- the real half-hour and quarter-hour zones: UTC-9:30, UTC-3:30, UTC+3:30, UTC+4:30, UTC+5:30, UTC+5:45, UTC+6:30, UTC+8:45, UTC+9:30, UTC+10:30, UTC+12:45, UTC+13:45

The pick is remembered in `localStorage` per browser, and anything unrecognised falls back to UTC+8. Changing the offset only moves where the local day starts; the price changes stay pinned to UTC.

## Schedule

The schedule repeats every day, so it is the same in every timezone.

| UTC+8 | UTC | Billing |
| --- | --- | --- |
| 00:00-09:00 | 16:00-01:00 | Off-peak (50% off) |
| 09:00-12:00 | 01:00-04:00 | Peak |
| 12:00-14:00 | 04:00-06:00 | Off-peak (50% off) |
| 14:00-18:00 | 06:00-10:00 | Peak |
| 18:00-24:00 | 10:00-16:00 | Off-peak (50% off) |

17 hours off-peak and 7 hours peak per day. Source: [DeepSeek API docs — Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/), effective 16 Aug 2026.

## Layout

The page fits one screen: three bands in a viewport-height grid, with every vertical measure tied to viewport height so a short window compresses it rather than pushing content below the fold. Below 860px wide the two panels fuse into one card and the lede drops; on a short phone the headings, legend and captions around the strip stand down.

The dot beside the eyebrow pulses while the page is open: an expanding halo that fades, tinted with the current state colour, so it reads as a live indicator. It stands still under `prefers-reduced-motion`.

## Verify

    node verify.mjs

Runs ~388k assertions that re-derive the schedule independently of the page code: every second of a UTC day, every boundary instant, a full month minute by minute, the billing windows behind the progress bar, the picker's offsets and their labels, and a sweep over every offered offset that checks the clocks, day strip and footer text against the UTC schedule. Results are identical under any host timezone.
