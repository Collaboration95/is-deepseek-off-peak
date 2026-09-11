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
const S = new Function(code + "\nreturn {isOffPeak,nextSwitchMs,nextTransitions,periodBounds,displayBoundaries,isOffPeakAtDisplayMinute,displaySecondsOfDay,displaySegments,scheduleNote,longestOffPeakRunMin,stretchLabel,offsetLabel,minuteLabel,pickerOffsets,isKnownOffset,coerceOffset,getBaseOffset,getBaseLabel,setBaseOffset,fmtHM,fmtHMS,fmtDayHM,baseHM,utcHM,pad2,wrapDay,utcSecondsOfDay,PEAK_WINDOWS,BOUNDARIES,DAY_MIN,DEFAULT_OFFSET_MIN,MIN_OFFSET_MIN,MAX_OFFSET_MIN};")();

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

// ===== DISPLAY BASE (defaults to UTC+8) =====

// 7. The display base must default to exactly UTC+8
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

// ===== TIMEZONE PICKER =====

// 13. Offset labels
const labelCases = [[-720, "UTC-12"], [-570, "UTC-9:30"], [-480, "UTC-8"], [-210, "UTC-3:30"], [-60, "UTC-1"], [0, "UTC"],
  [60, "UTC+1"], [210, "UTC+3:30"], [330, "UTC+5:30"], [345, "UTC+5:45"], [480, "UTC+8"], [525, "UTC+8:45"],
  [630, "UTC+10:30"], [765, "UTC+12:45"], [825, "UTC+13:45"], [840, "UTC+14"]];
for (const [min, want] of labelCases) {
  ok(S.offsetLabel(min) === want, "offsetLabel(" + min + ") = " + S.offsetLabel(min) + " want " + want);
}
ok(S.minuteLabel(0) === "00:00", "minuteLabel(0) = " + S.minuteLabel(0));
ok(S.minuteLabel(555) === "09:15", "minuteLabel(555) = " + S.minuteLabel(555));
ok(S.minuteLabel(1439) === "23:59", "minuteLabel(1439) = " + S.minuteLabel(1439));
ok(S.minuteLabel(1440) === "24:00", "minuteLabel(1440) = " + S.minuteLabel(1440) + " (the day must close at 24:00)");

// The stats row renders whole hours without a minutes part, and off-hour offsets with one.
ok(S.stretchLabel(540) === "9h", "stretchLabel(540) = " + S.stretchLabel(540) + " want 9h (UTC+8 default)");
ok(S.stretchLabel(900) === "15h", "stretchLabel(900) = " + S.stretchLabel(900) + " want 15h");
ok(S.stretchLabel(885) === "14h 45m", "stretchLabel(885) = " + S.stretchLabel(885) + " want 14h 45m (UTC+13:45)");
ok(S.stretchLabel(25) === "25m", "stretchLabel(25) = " + S.stretchLabel(25) + " want 25m");

// 14. Picker data: every option is a real quarter-hour offset, unique and in range
const pick = S.pickerOffsets();
const wholeHours = pick.filter((p) => p[1] === "").map((p) => p[0]);
const oddHours = pick.filter((p) => p[1] !== "").map((p) => p[0]);
ok(wholeHours.length === 27, "whole-hour options = " + wholeHours.length + " want 27 (UTC-12..UTC+14)");
ok(oddHours.length === 12, "half/quarter-hour options = " + oddHours.length + " want 12");
for (let h = -12; h <= 14; h++) ok(wholeHours.indexOf(h * 60) >= 0, "picker must offer UTC" + (h < 0 ? h : "+" + h) + " as a whole hour");
ok(wholeHours.every((v, i) => i === 0 || v > wholeHours[i - 1]), "whole hours must ascend");
ok(oddHours.every((v, i) => i === 0 || v > oddHours[i - 1]), "half/quarter hours must ascend");
ok(oddHours.every((v) => v % 60 !== 0), "the half/quarter group must not repeat a whole hour");
const pickSet = new Set();
for (const [min, hint] of pick) {
  ok(Number.isInteger(min) && min % 15 === 0, "picker offset " + min + " must sit on a quarter hour");
  ok(min >= S.MIN_OFFSET_MIN && min <= S.MAX_OFFSET_MIN, "picker offset " + min + " outside " + S.MIN_OFFSET_MIN + ".." + S.MAX_OFFSET_MIN);
  ok(typeof hint === "string", "picker hint must be a string at offset " + min);
  ok(!pickSet.has(min), "duplicate picker offset " + min);
  ok(S.isKnownOffset(min), "isKnownOffset must accept picker offset " + min);
  ok(S.coerceOffset(min) === min, "coerceOffset(number " + min + ")");
  ok(S.coerceOffset(String(min)) === min, "coerceOffset(string \"" + min + "\")");
  pickSet.add(min);
}
ok(S.coerceOffset(45) === null, "UTC+0:45 is not a real zone and must be rejected");
ok(S.coerceOffset(-765) === null, "UTC-12:45 must be rejected");
ok(S.coerceOffset(900) === null, "UTC+15 must be rejected");
ok(S.coerceOffset(481) === null, "a non-quarter-hour offset must be rejected");
ok([null, undefined, "", "  ", "UTC+8", "abc", NaN].every((v) => S.coerceOffset(v) === null), "coerceOffset must reject junk values");
ok([45, -765, 900, 1].every((v) => !S.isKnownOffset(v)), "isKnownOffset must reject non-offered offsets");

// 15. Switching the base retimes every derived value, and each offered offset still
//     agrees with an independent shift of the published UTC schedule.
for (const off of pick.map((p) => p[0])) {
  ok(S.setBaseOffset(off) === off, "setBaseOffset(" + off + ") must stick");
  ok(S.getBaseOffset() === off, "getBaseOffset after set = " + S.getBaseOffset() + " want " + off);
  ok(S.getBaseLabel() === S.offsetLabel(off), "getBaseLabel = " + S.getBaseLabel() + " want " + S.offsetLabel(off));

  for (const ms of [Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 8, 10, 6, 0), Date.UTC(2026, 11, 31, 23, 59, 59, 999), Date.now()]) {
    const shifted = new Date(ms + off * 60000);
    const hh = String(shifted.getUTCHours()).padStart(2, "0");
    const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
    const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
    const utc = new Date(ms);
    const utcSecOfDay = (utc.getUTCHours() * 3600 + utc.getUTCMinutes() * 60 + utc.getUTCSeconds()) * 1000 + utc.getUTCMilliseconds();
    const wantDaySec = (((utcSecOfDay + off * 60000) % 86400000) + 86400000) % 86400000;
    ok(S.baseHM(ms) === hh + ":" + mm, "baseHM at " + new Date(ms).toISOString() + " offset " + off + " = " + S.baseHM(ms) + " want " + hh + ":" + mm);
    ok(S.fmtHMS(ms, off) === hh + ":" + mm + ":" + ss, "fmtHMS at " + new Date(ms).toISOString() + " offset " + off + " = " + S.fmtHMS(ms, off));
    ok(S.displaySecondsOfDay(ms, off) === wantDaySec, "displaySecondsOfDay at " + new Date(ms).toISOString() + " offset " + off + " = " + S.displaySecondsOfDay(ms, off) + " want " + wantDaySec);
  }

  // Day strip: the segments tile the display day in the published order and are constant.
  const segs = S.displaySegments(off);
  // Four interior price changes normally make five segments; when one of them lands on
  // local midnight the strip starts on a change, which merges the two end segments.
  ok(segs.length === 4 || segs.length === 5, "offset " + off + ": day strip must have 4 or 5 segments, got " + segs.length);
  ok(segs.length === (S.displayBoundaries(off).indexOf(0) >= 0 ? 4 : 5), "offset " + off + ": segment count must follow the boundary set");
  ok(segs[0].start === 0, "offset " + off + ": segments must start at 00:00");
  ok(segs[segs.length - 1].end === 1440, "offset " + off + ": segments must end at 24:00");
  let offMinutes = 0;
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) ok(segs[i].start === segs[i - 1].end, "offset " + off + ": gap before segment " + i);
    // Edge segments are clipped by the local day: UTC+13:45 ends its day just 15 min
    // after the last price change, and half-hour bases clip the first one the same way.
    ok(segs[i].end - segs[i].start >= 15, "offset " + off + ": segment " + i + " shorter than a quarter hour");
    ok(segs[i].end - segs[i].start <= 900, "offset " + off + ": segment " + i + " longer than the 15h overnight window");
    if (segs[i].off) offMinutes += segs[i].end - segs[i].start;
    for (let m = segs[i].start; m < segs[i].end; m += 5) {
      const want = expectedOffPeak(Date.UTC(2026, 0, 1) + (m - off) * 60000);
      ok(segs[i].off === want, "offset " + off + ": segment " + i + " state wrong at display minute " + m);
      ok(S.isOffPeakAtDisplayMinute(m, off) === want, "offset " + off + ": state wrong at display minute " + m);
    }
  }
  ok(offMinutes === 1020, "offset " + off + ": " + offMinutes + " off-peak minutes (want 1020 = 17h)");

  // The "longest off-peak run" stat must match a minute-by-minute sweep of the same local day.
  let run = 0;
  let longest = 0;
  for (let m = 0; m < 1440; m++) {
    if (expectedOffPeak(Date.UTC(2026, 0, 1) + (m - off) * 60000)) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  ok(S.longestOffPeakRunMin(off) === longest, "offset " + off + ": longest off-peak run " + S.longestOffPeakRunMin(off) + " min, want " + longest);
  // Measured across every offered offset the stat spans 7h30m (UTC+6:30) to 15h (UTC-10).
  ok(longest >= 450 && longest <= 900, "offset " + off + ": longest run " + longest + " min outside the 7h30m..15h range");

  // The footer sentence must describe exactly those segments.
  const note = S.scheduleNote(off);
  let wantNote = "Schedule (" + S.offsetLabel(off) + "): " +
    segs.map((s) => (s.off ? "off-peak " : "peak ") + S.minuteLabel(s.start) + "\u2013" + S.minuteLabel(s.end)).join(", ") +
    " \u2014 17 h per day at 50% off.";
  ok(note === wantNote, "scheduleNote at offset " + off + ":\n    got  " + note + "\n    want " + wantNote);
}

// 16. The shipped HTML must already read as the default (no flash before the script runs),
//     and out-of-range picks must leave the base alone.
ok(html.includes(S.scheduleNote(480)), "index.html footer text must equal scheduleNote(480):\n    " + S.scheduleNote(480));
ok(html.includes('id="scheduleNote"'), "index.html must keep the scheduleNote hook");
ok(html.includes('id="metaDesc"'), "index.html must keep the metaDesc hook");
ok(html.includes('id="tzSelect"'), "index.html must keep the tzSelect hook");
// Before the script runs the page must already read as UTC+8, stats row included.
ok(html.includes('id="displayHeadline">Off-peak right now.<'), "index.html headline must ship as the UTC+8 default: " + (html.match(/id="displayHeadline">[^<]*/) || [""])[0]);
ok(html.includes('id="statLongest">' + S.stretchLabel(S.longestOffPeakRunMin(480)) + "<"), "index.html longest-run stat must ship as " + S.stretchLabel(S.longestOffPeakRunMin(480)) + " (UTC+8 default), got " + (html.match(/id="statLongest">[^<]*/) || [""])[0]);
ok(S.longestOffPeakRunMin(480) === 540, "the UTC+8 longest run must be 9h, got " + S.longestOffPeakRunMin(480) + " min");
ok(S.setBaseOffset(480) === 480 && S.getBaseOffset() === 480, "the base must start section 16 at UTC+8");
ok(S.setBaseOffset(900) === 480 && S.getBaseOffset() === 480, "setBaseOffset must ignore out-of-range offsets");
ok(S.setBaseOffset(45) === 480 && S.getBaseOffset() === 480, "setBaseOffset must ignore made-up offsets");
ok(S.setBaseOffset(NaN) === 480 && S.getBaseOffset() === 480, "setBaseOffset must ignore NaN");
ok(S.setBaseOffset(330) === 330 && S.getBaseOffset() === 330 && S.getBaseLabel() === "UTC+5:30", "setBaseOffset(330) must land on UTC+5:30");
ok(S.baseHM(Date.UTC(2026, 8, 10, 1, 0)) === "06:30", "01:00 UTC at UTC+5:30 must read 06:30, got " + S.baseHM(Date.UTC(2026, 8, 10, 1, 0)));
ok(S.setBaseOffset(480) === 480 && S.getBaseLabel() === "UTC+8", "the base must be restorable to UTC+8");
ok(S.baseHM(Date.UTC(2026, 8, 10, 1, 0)) === "09:00", "01:00 UTC must read 09:00 again once UTC+8 is restored");
ok(S.getBaseOffset() === 480, "verify must leave the base at its default");

if (failures.length) {
  console.error("FAIL — " + failures.length + " of " + checks + " checks failed");
  for (const f of failures.slice(0, 12)) console.error("  - " + f);
  process.exit(1);
}
console.log("PASS — " + checks + " checks (default base UTC+8, " + pickSet.size + " pickable offsets, host TZ=" + (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) + ")");
