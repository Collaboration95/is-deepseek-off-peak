import { readFileSync } from "node:fs";

const path = process.argv[2] || "index.html";
const html = readFileSync(path, "utf8");
const start = html.indexOf("// ===== SCHEDULE-LOGIC-START =====");
const end = html.indexOf("// ===== SCHEDULE-LOGIC-END =====");
if (start < 0 || end < 0 || end <= start) {
  console.error("FAIL: schedule logic markers missing from " + path);
  process.exit(1);
}
const code = html.slice(start, end);
const S = new Function(code + "\nreturn {isOffPeak,isWeekend,nextSwitchMs,nextTransitions,periodBounds,displayBoundaries,isOffPeakAtDisplayMinute,displaySecondsOfDay,displaySegments,scheduleNote,offsetLabel,minuteLabel,pickerOffsets,isKnownOffset,coerceOffset,getBaseOffset,getBaseLabel,setBaseOffset,fmtHM,fmtHMS,fmtDayHM,displayDayStartMs,displayDayLabel,baseHM,utcHM,DEFAULT_OFFSET_MIN,DEFAULT_LABEL,MIN_OFFSET_MIN,MAX_OFFSET_MIN};")();

let checks = 0;
const failures = [];
function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

const DAY_MS = 86400000;
const PEAK_WINDOWS = [[1, 4], [6, 10]];

// Independent expectation model, written from the published weekday schedule.
function expectedOffPeak(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 +
    (d.getUTCSeconds() * 1000 + d.getUTCMilliseconds()) / 3600000;
  return !PEAK_WINDOWS.some(([a, b]) => h >= a && h < b);
}

function midnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function independentTransitionsAround(ms) {
  const base = midnight(ms);
  const out = [];
  for (let dayOffset = -8; dayOffset <= 8; dayOffset++) {
    const dayStart = base + dayOffset * DAY_MS;
    const day = new Date(dayStart).getUTCDay();
    if (day === 0 || day === 6) continue;
    for (const [from, to] of PEAK_WINDOWS) {
      out.push(dayStart + from * 3600000, dayStart + to * 3600000);
    }
  }
  return out.sort((a, b) => a - b);
}

function expectedNextSwitch(ms) {
  return independentTransitionsAround(ms).find((x) => x > ms);
}

function expectedPreviousSwitch(ms) {
  const all = independentTransitionsAround(ms);
  return all.filter((x) => x <= ms).at(-1);
}

// 1. Full weekday and weekend UTC days, second by second.
for (const dayStart of [Date.UTC(2026, 8, 10), Date.UTC(2026, 8, 12)]) {
  for (let ms = dayStart; ms < dayStart + DAY_MS; ms += 1000) {
    ok(S.isOffPeak(ms) === expectedOffPeak(ms), "isOffPeak mismatch at " + new Date(ms).toISOString());
    ok(S.nextSwitchMs(ms) === expectedNextSwitch(ms), "nextSwitchMs mismatch at " + new Date(ms).toISOString());
    ok(S.nextSwitchMs(ms) > ms, "next switch not in the future at " + new Date(ms).toISOString());
  }
}

// 2. Every weekday boundary, plus the Friday-to-Monday weekend transition, +-1ms.
const transitionCases = [
  Date.UTC(2026, 8, 10, 1), Date.UTC(2026, 8, 10, 4),
  Date.UTC(2026, 8, 10, 6), Date.UTC(2026, 8, 10, 10),
  Date.UTC(2026, 8, 11, 10), Date.UTC(2026, 8, 14, 1)
];
for (const b of transitionCases) {
  ok(S.nextSwitchMs(b) === expectedNextSwitch(b), "boundary next switch wrong at " + new Date(b).toISOString());
  ok(S.isOffPeak(b - 1) === expectedOffPeak(b - 1), "state 1ms before " + new Date(b).toISOString() + " wrong");
  ok(S.isOffPeak(b) === expectedOffPeak(b), "state at " + new Date(b).toISOString() + " wrong");
  ok(S.isOffPeak(b - 1) !== S.isOffPeak(b), "no state change at " + new Date(b).toISOString());
  ok(S.nextSwitchMs(b - 1) === b, "countdown should land exactly on " + new Date(b).toISOString());
}

// 3. September 2026 totals: 22 weekdays at 17/7 hours and 8 weekend days at 24/0.
let offMin = 0, peakMin = 0;
for (let ms = Date.UTC(2026, 8, 1); ms < Date.UTC(2026, 9, 1); ms += 60000) {
  if (S.isOffPeak(ms)) offMin++;
  else peakMin++;
}
ok(offMin === 33960, "September off-peak minutes = " + offMin + " (want 33960)");
ok(peakMin === 9240, "September peak minutes = " + peakMin + " (want 9240)");

// 4. Transition list integrity, including the long Friday-to-Monday gap.
const from = Date.UTC(2026, 8, 11, 12, 34, 56);
const items = S.nextTransitions(from, 8);
for (let i = 0; i < items.length; i++) {
  if (i > 0) ok(items[i].at > items[i - 1].at, "transitions not increasing at index " + i);
  ok(S.isOffPeak(items[i].at) === items[i].toOffPeak, "transition state label wrong at index " + i);
  ok(S.isOffPeak(items[i].at - 1) !== items[i].toOffPeak, "transition at index " + i + " does not flip the state");
  ok(items[i].at === expectedNextSwitch(i ? items[i - 1].at : from), "transition outside published schedule at index " + i);
}
const fridayEnd = Date.UTC(2026, 8, 11, 10);
const mondayStart = Date.UTC(2026, 8, 14, 1);
ok(S.nextSwitchMs(fridayEnd) === mondayStart, "Friday 10:00 UTC must jump to Monday 01:00 UTC");
ok(mondayStart - fridayEnd === 63 * 3600000, "Friday-to-Monday off-peak window must last 63 hours");

// 5. periodBounds follows the previous/next real transition, including weekends.
const allowedLengths = [2, 3, 4, 15, 63].map((h) => h * 3600000);
for (let ms = Date.UTC(2026, 8, 10); ms < Date.UTC(2026, 8, 15); ms += 60000) {
  const p = S.periodBounds(ms);
  const wantStart = expectedPreviousSwitch(ms);
  const wantEnd = expectedNextSwitch(ms);
  ok(p.start === wantStart, "window start wrong at " + new Date(ms).toISOString());
  ok(p.end === wantEnd, "window end wrong at " + new Date(ms).toISOString());
  ok(p.start <= ms && ms < p.end, "window does not contain now at " + new Date(ms).toISOString());
  ok(S.isOffPeak(p.start + 1) === S.isOffPeak(p.end - 1), "state changes inside a window at " + new Date(ms).toISOString());
  ok(allowedLengths.includes(p.end - p.start), "unexpected window length " + (p.end - p.start));
}
const weekendBounds = S.periodBounds(Date.UTC(2026, 8, 12, 12));
ok(weekendBounds.start === fridayEnd && weekendBounds.end === mondayStart, "weekend period bounds must span Friday 10:00 to Monday 01:00 UTC");

// ===== DISPLAY BASE (defaults to UTC+8) =====

// 6. The display base must default to exactly UTC+8 and render both clocks correctly.
ok(S.DEFAULT_OFFSET_MIN === 480, "default offset must be 480 minutes, got " + S.DEFAULT_OFFSET_MIN);
ok(S.setBaseOffset(480) === 480, "setBaseOffset(480) must stick");
ok(S.getBaseOffset() === 480, "base offset must start at 480, got " + S.getBaseOffset());
ok(S.getBaseLabel() === "UTC+8", "base label must be UTC+8, got " + S.getBaseLabel());
for (const ms of [Date.UTC(2026, 8, 10, 1, 0), Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 11, 31, 23, 59), Date.now()]) {
  const shifted = new Date(ms + 8 * 3600000);
  const want = String(shifted.getUTCHours()).padStart(2, "0") + ":" + String(shifted.getUTCMinutes()).padStart(2, "0");
  ok(S.baseHM(ms) === want, "baseHM at " + new Date(ms).toISOString() + " = " + S.baseHM(ms) + " want " + want);
  ok(S.utcHM(ms) === new Date(ms).toISOString().slice(11, 16), "utcHM at " + new Date(ms).toISOString() + " = " + S.utcHM(ms));
}

// 7. UTC+8 weekday rendering and local-day rollovers.
const weekdayRef = Date.UTC(2026, 8, 10, 12);
const weekendRef = Date.UTC(2026, 8, 12, 12);
ok(S.baseHM(Date.UTC(2026, 8, 10, 1, 0)) === "09:00", "01:00 UTC must render 09:00 UTC+8");
ok(S.baseHM(Date.UTC(2026, 8, 10, 6, 0)) === "14:00", "06:00 UTC must render 14:00 UTC+8");
ok(S.baseHM(Date.UTC(2026, 8, 10, 10, 0)) === "18:00", "10:00 UTC must render 18:00 UTC+8");
ok(S.fmtDayHM(Date.UTC(2026, 8, 10, 1, 0), 480) === "Thu 09:00", "day+time at 01:00 UTC must be Thu 09:00 UTC+8");
ok(S.fmtDayHM(Date.UTC(2026, 8, 10, 22, 30), 480) === "Fri 06:30", "22:30 UTC Thu must be Fri 06:30 UTC+8");
ok(S.displayDayLabel(480, weekdayRef) === "Thu", "UTC+8 weekday reference must label Thu");
ok(S.displayDayLabel(480, weekendRef) === "Sat", "UTC+8 weekend reference must label Sat");

// 8. Day-strip boundaries, segments and notes are date-aware for every offered offset.
const pick = S.pickerOffsets();
for (const off of pick.map((p) => p[0])) {
  for (const [referenceMs, wantWeekend] of [[weekdayRef, false], [weekendRef, true]]) {
    const dayStart = S.displayDayStartMs(off, referenceMs);
    const dayEnd = dayStart + DAY_MS;
    const expectedBounds = independentTransitionsAround(dayStart)
      .filter((t) => t >= dayStart && t < dayEnd)
      .map((t) => Math.round((t - dayStart) / 60000));
    const bounds = S.displayBoundaries(off, referenceMs);
    ok(JSON.stringify(bounds) === JSON.stringify(expectedBounds), "offset " + off + " boundaries mismatch for " + new Date(referenceMs).toISOString());

    const segs = S.displaySegments(off, referenceMs);
    ok(segs[0].start === 0, "offset " + off + ": segments must start at 00:00");
    ok(segs.at(-1).end === 1440, "offset " + off + ": segments must end at 24:00");
    let offMinutes = 0, peakMinutes = 0;
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) ok(segs[i].start === segs[i - 1].end, "offset " + off + ": gap before segment " + i);
      ok(segs[i].end > segs[i].start, "offset " + off + ": empty segment " + i);
      for (let m = segs[i].start; m < segs[i].end; m += 5) {
        const want = expectedOffPeak(dayStart + m * 60000);
        ok(segs[i].off === want, "offset " + off + ": segment " + i + " state wrong at minute " + m);
        ok(S.isOffPeakAtDisplayMinute(m, off, referenceMs) === want, "offset " + off + ": display state wrong at minute " + m);
      }
      if (segs[i].off) offMinutes += segs[i].end - segs[i].start;
      else peakMinutes += segs[i].end - segs[i].start;
    }
    if (wantWeekend) {
      ok(offMinutes === 1440 && peakMinutes === 0, "offset " + off + ": weekend must be 24h off-peak");
      ok(S.scheduleNote(off, referenceMs).includes("off-peak all day; peak none (weekend)"), "offset " + off + ": weekend note must say all day off-peak");
    } else {
      ok(offMinutes === 1020 && peakMinutes === 420, "offset " + off + ": weekday must be 17h off-peak and 7h peak");
      ok(S.scheduleNote(off, referenceMs).includes("; peak "), "offset " + off + ": weekday note must list peak windows");
    }
  }
}

// 9. Marker position stays monotonic inside a selected local day.
const baseMidnight = S.displayDayStartMs(480, weekdayRef);
ok(S.displaySecondsOfDay(baseMidnight, 480) === 0, "base midnight must map to 0");
ok(S.displaySecondsOfDay(baseMidnight + 3600000, 480) === 3600000, "01:00 base must map to 3600000");
ok(S.displaySecondsOfDay(baseMidnight - 1000, 480) === 86400000 - 1000, "one second before base midnight must wrap to end of day");
let prevFrac = -1;
for (let m = 0; m < 1440; m += 7) {
  const f = S.displaySecondsOfDay(baseMidnight + m * 60000, 480);
  ok(f > prevFrac, "base-day fraction not increasing at minute " + m);
  prevFrac = f;
}

// ===== TIMEZONE PICKER =====

// 10. Picker data contains every offered real quarter-hour offset exactly once.
const wholeHours = pick.filter((p) => p[1] === "").map((p) => p[0]);
const oddHours = pick.filter((p) => p[1] !== "").map((p) => p[0]);
ok(wholeHours.length === 27, "whole-hour options = " + wholeHours.length + " want 27");
ok(oddHours.length === 12, "half/quarter-hour options = " + oddHours.length + " want 12");
for (let h = -12; h <= 14; h++) ok(wholeHours.includes(h * 60), "picker must offer UTC" + (h < 0 ? h : "+" + h));
ok(wholeHours.every((v, i) => i === 0 || v > wholeHours[i - 1]), "whole hours must ascend");
ok(oddHours.every((v, i) => i === 0 || v > oddHours[i - 1]), "half/quarter hours must ascend");
ok(oddHours.every((v) => v % 60 !== 0), "the half/quarter group must not repeat a whole hour");
const pickSet = new Set();
for (const [min, hint] of pick) {
  ok(Number.isInteger(min) && min % 15 === 0, "picker offset " + min + " must sit on a quarter hour");
  ok(min >= S.MIN_OFFSET_MIN && min <= S.MAX_OFFSET_MIN, "picker offset " + min + " outside range");
  ok(typeof hint === "string", "picker hint must be a string at offset " + min);
  ok(!pickSet.has(min), "duplicate picker offset " + min);
  ok(S.isKnownOffset(min), "isKnownOffset must accept picker offset " + min);
  ok(S.coerceOffset(min) === min, "coerceOffset(number " + min + ")");
  ok(S.coerceOffset(String(min)) === min, "coerceOffset(string \"" + min + "\")");
  pickSet.add(min);
}
ok(S.coerceOffset(45) === null, "UTC+0:45 is not an offered zone");
ok(S.coerceOffset(-765) === null, "UTC-12:45 must be rejected");
ok(S.coerceOffset(900) === null, "UTC+15 must be rejected");
ok(S.coerceOffset(481) === null, "a non-quarter-hour offset must be rejected");
ok([null, undefined, "", "  ", "UTC+8", "abc", NaN].every((v) => S.coerceOffset(v) === null), "coerceOffset must reject junk values");

// 11. Switching the base retimes every derived clock without changing UTC pricing.
for (const off of pick.map((p) => p[0])) {
  ok(S.setBaseOffset(off) === off, "setBaseOffset(" + off + ") must stick");
  ok(S.getBaseLabel() === S.offsetLabel(off), "getBaseLabel after set = " + S.getBaseLabel());
  for (const ms of [Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 8, 12, 6, 0), Date.UTC(2026, 11, 31, 23, 59, 59, 999)]) {
    const shifted = new Date(ms + off * 60000);
    const hh = String(shifted.getUTCHours()).padStart(2, "0");
    const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
    const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
    ok(S.baseHM(ms) === hh + ":" + mm, "baseHM at " + new Date(ms).toISOString() + " offset " + off);
    ok(S.fmtHMS(ms, off) === hh + ":" + mm + ":" + ss, "fmtHMS at " + new Date(ms).toISOString() + " offset " + off);
    ok(S.isOffPeak(ms) === expectedOffPeak(ms), "changing display offset must not alter UTC state");
  }
}

// 12. Shipped copy and invalid picks.
ok(html.includes("Monday–Friday"), "HTML schedule copy must mention weekdays");
ok(html.includes("weekends are fully off-peak"), "HTML copy must mention fully off-peak weekends");
ok(html.includes('id="scheduleNote"'), "index.html must keep the scheduleNote hook");
ok(html.includes('id="metaDesc"'), "index.html must keep the metaDesc hook");
ok(html.includes('id="tzSelect"'), "index.html must keep the tzSelect hook");
ok(html.includes('id="displayHeadline">Off-peak right now.<'), "index.html must ship an off-peak default headline");
ok(S.setBaseOffset(900) === pick.at(-1)[0], "out-of-range pick must leave the current base alone");
ok(S.setBaseOffset(45) === pick.at(-1)[0], "made-up pick must leave the current base alone");
ok(S.setBaseOffset(480) === 480 && S.getBaseLabel() === "UTC+8", "the base must be restorable to UTC+8");

if (failures.length) {
  console.error("FAIL — " + failures.length + " of " + checks + " checks failed");
  for (const f of failures.slice(0, 12)) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS — " + checks + " checks (weekday peak schedule, weekends off-peak, " + pickSet.size + " pickable offsets, host TZ=" + (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) + ")");
