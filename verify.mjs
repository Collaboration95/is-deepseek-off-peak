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
const S = new Function(code + "\nreturn {isOffPeak,nextSwitchMs,nextTransitions,periodBounds,displayBoundaries,isOffPeakAtDisplayMinute,displaySecondsOfDay,fmtHM,fmtHMS,fmtDayHM,baseHM,utcHM,pad2,wrapDay,utcSecondsOfDay,PEAK_WINDOWS,BOUNDARIES,DAY_MIN,BASE_OFFSET_MIN,BASE_LABEL};")();

let checks = 0;
const failures = [];
function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

// --- Independent expectation model, written from the published schedule ---
// DeepSeek bills peak during 01:00-04:00 and 06:00-10:00 UTC, off-peak otherwise.
function expectedOffPeak(ms) {
  const d = new Date(ms);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + (d.getUTCSeconds() * 1000 + d.getUTCMilliseconds()) / 3600000;
  return !((h >= 1 && h < 4) || (h >= 6 && h < 10));
}
function boundaryInstantsAround(ms) {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const out = [];
  for (const day of [-1, 0, 1, 2]) for (const h of [1, 4, 6, 10]) out.push(midnight + day * 86400000 + h * 3600000);
  return out.sort((a, b) => a - b);
}
function expectedNextSwitch(ms) {
  return Math.min(...boundaryInstantsAround(ms).filter((x) => x > ms));
}

// 1. Full UTC day, second by second
const dayStart = Date.UTC(2026, 8, 10, 0, 0, 0);
for (let ms = dayStart; ms < dayStart + 86400000; ms += 1000) {
  ok(S.isOffPeak(ms) === expectedOffPeak(ms), "isOffPeak mismatch at " + new Date(ms).toISOString());
  ok(S.nextSwitchMs(ms) === expectedNextSwitch(ms), "nextSwitchMs mismatch at " + new Date(ms).toISOString());
  ok(S.nextSwitchMs(ms) > ms, "next switch not in the future at " + new Date(ms).toISOString());
  ok(S.nextSwitchMs(ms) - ms <= 86400000, "next switch more than 24h away at " + new Date(ms).toISOString());
}

// 2. Every boundary instant, +-1ms
for (const h of [1, 4, 6, 10]) {
  const b = Date.UTC(2026, 8, 10, h, 0, 0);
  ok(S.nextSwitchMs(b) === expectedNextSwitch(b), "boundary next switch wrong at " + h + ":00 UTC");
  ok(S.isOffPeak(b - 1) === expectedOffPeak(b - 1), "state 1ms before " + h + ":00 UTC wrong");
  ok(S.isOffPeak(b) === expectedOffPeak(b), "state at " + h + ":00 UTC wrong");
  ok(S.isOffPeak(b - 1) !== S.isOffPeak(b), "no state change at boundary " + h + ":00 UTC");
  ok(S.nextSwitchMs(b - 1) === b, "countdown should land exactly on boundary " + h + ":00 UTC");
}

// 3. A full month, minute by minute: 17h off-peak / 7h peak daily, weekends included
let offMin = 0, peakMin = 0;
for (let ms = Date.UTC(2026, 8, 1); ms < Date.UTC(2026, 9, 1); ms += 60000) (S.isOffPeak(ms) ? offMin++ : peakMin++);
ok(offMin === 17 * 60 * 30, "September off-peak minutes = " + offMin + " (want " + 17 * 60 * 30 + ")");
ok(peakMin === 7 * 60 * 30, "September peak minutes = " + peakMin + " (want " + 7 * 60 * 30 + ")");

// 4. Transition list integrity
const from = Date.UTC(2026, 8, 10, 12, 34, 56);
const items = S.nextTransitions(from, 8);
for (let i = 0; i < items.length; i++) {
  if (i > 0) ok(items[i].at > items[i - 1].at, "transitions not increasing at index " + i);
  ok(S.isOffPeak(items[i].at) === items[i].toOffPeak, "transition state label wrong at index " + i);
  ok(S.isOffPeak(items[i].at - 1) !== items[i].toOffPeak, "transition at index " + i + " does not flip the state");
  ok(items[i].at === expectedNextSwitch(i ? items[i - 1].at : from), "transition outside published schedule at index " + i);
}
ok(items[4].at - items[0].at === 86400000, "4 transitions should span exactly 24h");

// 5. periodBounds equals the real billing windows, including the 15h window crossing UTC midnight
const allowedLengths = [2 * 3600000, 3 * 3600000, 4 * 3600000, 15 * 3600000];
for (let ms = dayStart; ms < dayStart + 86400000; ms += 60000) {
  const b = boundaryInstantsAround(ms);
  const wantStart = Math.max(...b.filter((x) => x <= ms));
  const wantEnd = Math.min(...b.filter((x) => x > ms));
  const p = S.periodBounds(ms);
  ok(p.start === wantStart, "window start wrong at " + new Date(ms).toISOString());
  ok(p.end === wantEnd, "window end wrong at " + new Date(ms).toISOString());
  ok(p.start <= ms && ms < p.end, "window does not contain now at " + new Date(ms).toISOString());
  ok(S.isOffPeak(p.start + 1) === S.isOffPeak(p.end - 1), "state changes inside a window at " + new Date(ms).toISOString());
  ok(allowedLengths.indexOf(p.end - p.start) >= 0, "unexpected window length " + (p.end - p.start));
}

// 6. Four chained windows always close a 24h cycle in the same state
for (const startMs of [Date.UTC(2026, 8, 10, 12, 0, 0), Date.UTC(2026, 8, 10, 0, 30, 0), Date.UTC(2026, 8, 10, 5, 0, 0), Date.UTC(2026, 11, 31, 23, 45, 0), Date.UTC(2026, 8, 10, 10, 0, 0), Date.UTC(2026, 8, 10, 1, 0, 0)]) {
  let at = startMs;
  let total = 0;
  for (let i = 0; i < 4; i++) { const p = S.periodBounds(at); total += p.end - p.start; at = p.end; }
  ok(total === 86400000, "four chained windows from " + new Date(startMs).toISOString() + " cover " + total + "ms, want 86400000");
  ok(S.isOffPeak(at) === S.isOffPeak(startMs), "state after a full cycle differs at " + new Date(startMs).toISOString());
}

// ===== UTC+8 BASE =====

// 7. The base offset must be exactly UTC+8
ok(S.BASE_OFFSET_MIN === 480, "base offset must be 480 minutes, got " + S.BASE_OFFSET_MIN);
ok(S.BASE_LABEL === "UTC+8", "base label must be UTC+8, got " + S.BASE_LABEL);
for (const ms of [Date.UTC(2026, 8, 10, 1, 0), Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 11, 31, 23, 59), Date.now()]) {
  const shifted = new Date(ms + 8 * 3600000);
  const want = String(shifted.getUTCHours()).padStart(2, "0") + ":" + String(shifted.getUTCMinutes()).padStart(2, "0");
  ok(S.baseHM(ms) === want, "baseHM at " + new Date(ms).toISOString() + " = " + S.baseHM(ms) + " want " + want);
  ok(S.utcHM(ms) === new Date(ms).toISOString().slice(11, 16), "utcHM at " + new Date(ms).toISOString() + " = " + S.utcHM(ms));
}

// 8. UTC+8 rendering of the schedule, including day rollover and midnight
ok(S.baseHM(Date.UTC(2026, 8, 10, 1, 0)) === "09:00", "01:00 UTC must render 09:00 UTC+8, got " + S.baseHM(Date.UTC(2026, 8, 10, 1, 0)));
ok(S.baseHM(Date.UTC(2026, 8, 10, 6, 0)) === "14:00", "06:00 UTC must render 14:00 UTC+8");
ok(S.baseHM(Date.UTC(2026, 8, 10, 10, 0)) === "18:00", "10:00 UTC must render 18:00 UTC+8");
ok(S.baseHM(Date.UTC(2026, 8, 10, 4, 0)) === "12:00", "04:00 UTC must render 12:00 UTC+8");
ok(S.fmtDayHM(Date.UTC(2026, 8, 10, 1, 0), 480) === "Thu 09:00", "day+time at 01:00 UTC = " + S.fmtDayHM(Date.UTC(2026, 8, 10, 1, 0), 480));
ok(S.fmtDayHM(Date.UTC(2026, 8, 10, 22, 30), 480) === "Fri 06:30", "22:30 UTC Thu must be Fri 06:30 UTC+8, got " + S.fmtDayHM(Date.UTC(2026, 8, 10, 22, 30), 480));
ok(S.baseHM(Date.UTC(2026, 8, 10, 16, 0)) === "00:00", "16:00 UTC must render midnight 00:00 UTC+8 (not 24:00), got " + S.baseHM(Date.UTC(2026, 8, 10, 16, 0)));
ok(S.fmtHMS(Date.UTC(2026, 8, 10, 16, 0, 5), 480) === "00:00:05", "HMS midnight UTC+8 = " + S.fmtHMS(Date.UTC(2026, 8, 10, 16, 0, 5), 480));

// 9. Day-strip boundaries in the base timezone: 09:00, 12:00, 14:00, 18:00 local
ok(JSON.stringify(S.displayBoundaries(480)) === JSON.stringify([540, 720, 840, 1080]),
  "UTC+8 boundaries = " + JSON.stringify(S.displayBoundaries(480)) + " want [540,720,840,1080] (09:00,12:00,14:00,18:00)");
ok(JSON.stringify(S.displayBoundaries(0)) === JSON.stringify([60, 240, 360, 600]), "UTC boundaries must equal the raw schedule");
ok(S.displayBoundaries(480).length === 4, "base strip should have four boundaries, got " + S.displayBoundaries(480).length);
ok(S.displayBoundaries(480).every((v) => v > 0 && v < 1440), "base boundaries must fall inside the day");

// 10. Per-minute sweep of the base day for several offsets, against the UTC schedule
for (const offset of [480, 0, -300, 330, -720, 840, 60]) {
  let off = 0, peak = 0, flips = 0, prev = null;
  for (let m = 0; m < 1440; m++) {
    const want = expectedOffPeak(Date.UTC(2026, 0, 1) + ((m - offset) * 60000));
    const got = S.isOffPeakAtDisplayMinute(m, offset);
    ok(got === want, "offset " + offset + " state wrong at base minute " + m);
    got ? off++ : peak++;
    if (prev !== null && got !== prev) flips++;
    prev = got;
  }
  ok(off === 1020 && peak === 420, "offset " + offset + ": off=" + off + " peak=" + peak + " (want 1020/420)");
  const b = S.displayBoundaries(offset);
  // A boundary landing exactly on minute 0 produces no in-day flip, so only count interior ones.
  const interior = b.filter((v) => v > 0).length;
  ok(flips === interior, "offset " + offset + ": " + flips + " state changes, want " + interior);
  for (let i = 0; i < b.length; i++) {
    ok(S.isOffPeakAtDisplayMinute(b[i] - 1, offset) !== S.isOffPeakAtDisplayMinute(b[i], offset),
      "offset " + offset + ": boundary at minute " + b[i] + " does not flip the state");
  }
  // The schedule repeats every day, so the base day must be exactly periodic.
  for (let m = 0; m < 1440; m += 17) {
    ok(S.isOffPeakAtDisplayMinute(1440 + m, offset) === S.isOffPeakAtDisplayMinute(m, offset),
      "offset " + offset + ": schedule not periodic at base minute " + m);
  }
}

// 11. Marker position: base-day fraction is monotonic inside a base day and wraps at base midnight
const baseMidnight = Date.UTC(2026, 8, 10, 16, 0, 0); // 00:00 UTC+8 on 11 Sep
ok(S.displaySecondsOfDay(baseMidnight, 480) === 0, "base midnight must map to 0, got " + S.displaySecondsOfDay(baseMidnight, 480));
ok(S.displaySecondsOfDay(baseMidnight + 3600000, 480) === 3600000, "01:00 base must map to 3600000");
ok(S.displaySecondsOfDay(baseMidnight - 1000, 480) === 86400000 - 1000, "one second before base midnight must wrap to end of day");
let prevFrac = -1;
for (let m = 0; m < 1440; m += 7) {
  const f = S.displaySecondsOfDay(baseMidnight + m * 60000, 480);
  ok(f > prevFrac, "base-day fraction not increasing at minute " + m);
  prevFrac = f;
}
ok(prevFrac < 86400000, "fraction must stay inside the day");

// 12. Windows as the page labels them, in UTC+8
// Each case: instant, expected window start/end in UTC+8, expected state, and the UTC+8 wall time.
const cases = [
  [Date.UTC(2026, 8, 10, 12, 30), "18:00", "09:00", true, "20:30"],  // off-peak, crosses base midnight
  [Date.UTC(2026, 8, 9, 17, 0), "18:00", "09:00", true, "01:00"],    // 01:00 base time; base midnight is not a price change, so this continues the 18:00 window
  [Date.UTC(2026, 8, 10, 1, 30), "09:00", "12:00", false, "09:30"],  // peak
  [Date.UTC(2026, 8, 10, 5, 0), "12:00", "14:00", true, "13:00"],    // off-peak
  [Date.UTC(2026, 8, 10, 8, 0), "14:00", "18:00", false, "16:00"],   // peak
  [Date.UTC(2026, 8, 10, 18, 0), "18:00", "09:00", true, "02:00"],   // 02:00 next base day
  [Date.UTC(2026, 8, 10, 23, 30), "18:00", "09:00", true, "07:30"],  // 07:30 next base day, last off-peak hour
  [Date.UTC(2026, 8, 10, 22, 0), "18:00", "09:00", true, "06:00"]    // 06:00 base time, still in the overnight off-peak stretch
];
for (const [ms, wantStart, wantEnd, wantOff, wantBaseTime] of cases) {
  const p = S.periodBounds(ms);
  const tag = new Date(ms).toISOString();
  ok(S.baseHM(ms) === wantBaseTime, "base time at " + tag + " = " + S.baseHM(ms) + " want " + wantBaseTime);
  ok(S.baseHM(p.start) === wantStart, "window start at " + tag + " = " + S.baseHM(p.start) + " want " + wantStart);
  ok(S.baseHM(p.end) === wantEnd, "window end at " + tag + " = " + S.baseHM(p.end) + " want " + wantEnd);
  ok(S.isOffPeak(ms) === wantOff, "state at " + tag + " = " + (S.isOffPeak(ms) ? "off-peak" : "peak") + " want " + (wantOff ? "off-peak" : "peak"));
  ok(p.end - p.start > 0 && p.end - p.start <= 15 * 3600000, "window length out of range at " + tag);
  // The window must end exactly at a published price change, and the state must flip there.
  ok(S.isOffPeak(p.end - 1) === wantOff, "state just before window end at " + tag + " should still be the window state");
  ok(S.isOffPeak(p.end) !== wantOff, "state should flip at the window end for " + tag);
}

if (failures.length) {
  console.error("FAIL — " + failures.length + " of " + checks + " checks failed");
  for (const f of failures.slice(0, 12)) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS — " + checks + " checks (base UTC+8, host TZ=" + (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) + ")");
