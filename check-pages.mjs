// Checker for the date models shipped in saturday.html and christmas.html.
// Run: node check-pages.mjs
// Both pages keep their model in a pure <script> block; this re-evaluates the real
// block from each file, so the checks can never agree with a stale copy of the logic.
import { readFileSync } from 'node:fs';

const load = async (file, names) => {
  const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const block of blocks) {
    if (!/===== (Week|Christmas|Night) model /.test(block)) continue;
    return import('data:text/javascript,' + encodeURIComponent(block + `\nexport { ${names} };`));
  }
  throw new Error(`${file}: no model block found`);
};

const week = await load('saturday.html', 'cycle, countdown, weekStart, fmtLocal');
const xmas = await load('christmas.html', 'nextChristmas, christmasYear, seasonWindow, shifted');
const daily = await load('daily.html', 'night, atHour, shifted');

const TZ = 8 * 3600 * 1000;
const DAY = 86400000;
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// ICU punctuation varies by Node build — compare comma-stripped weekday + time.
const wall = (t) => week.fmtLocal(t, { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/,/g, '');

/* ───────────────────────── Saturday page (UTC+8 week) ───────────────────────── */

// The week containing Mon 2026-09-14 00:00 UTC+8 (= Sun 16:00Z).
const MON = Date.parse('2026-09-13T16:00:00Z');
const RESET = MON + 7 * DAY;
const SAT_END = MON + 6 * DAY;

// 1. The reset boundary is exactly Monday 00:00 UTC+8, for every hour of the week.
for (let h = 0; h < 7 * 24; h++) {
  const { reset } = week.cycle(MON + h * 3600000);
  check(reset === RESET, `week h=${h}: reset != next Monday 00:00 UTC+8`);
  check(wall(reset) === 'Monday 00:00', `week h=${h}: reset renders as ${wall(reset)}`);
}

// 2. Saturday ends at Sat 23:59:59 UTC+8 and the clock ticks to zero there, not a day early.
check(SAT_END === MON + 6 * DAY, 'week: Saturday does not end at Sun 00:00 UTC+8');
check(wall(SAT_END - 1000) === 'Saturday 23:59', 'week: last second is not Saturday 23:59 UTC+8');
for (const [label, t] of [['sat 12:00', MON + 5 * DAY + 12 * 3600000], ['sat 23:59:59', SAT_END - 1000]]) {
  const r = week.countdown(t);
  check(!r.pastSaturday, `week ${label}: flagged as past Saturday`);
  check(r.target === SAT_END, `week ${label}: target is not Saturday`);
  check(r.remaining === SAT_END - t, `week ${label}: remaining wrong`);
}
check(week.countdown(SAT_END - 1000).remaining === 1000, 'week: last second does not tick 1 -> 0');

// 3. Sunday counts to the reset; Monday 00:00 starts a fresh cycle.
const sun = week.countdown(MON + 6 * DAY + 3600000);
check(sun.pastSaturday && sun.target === RESET, 'week: Sunday does not count to the Monday reset');
check(sun.remaining === RESET - (MON + 6 * DAY + 3600000), 'week: Sunday remaining wrong');
const mon = week.countdown(MON);
check(!mon.pastSaturday && mon.remaining === 6 * DAY, 'week: Monday 00:00 does not start a fresh cycle');
for (let h = 0; h < 7 * 24; h++) {
  const r = week.countdown(MON + h * 3600000);
  check(r.remaining >= 0 && r.remaining <= 7 * DAY, `week h=${h}: remaining out of range`);
  check(r.progress >= 0 && r.progress <= 1, `week h=${h}: progress out of range`);
}

// 4. Host-independence is proved by the `TZ=` sweep in run-checks.sh (a different instant is not a
//    different host zone).

/* ───────────────────────── Christmas page (UTC+8 target) ───────────────────────── */

// 2026 target: Dec 25 00:00 UTC+8 == Dec 24 16:00Z.
const XMAS_2026 = Date.parse('2026-12-24T16:00:00Z');
check(XMAS_2026 === Date.UTC(2026, 11, 24, 16), 'xmas: Dec 25 00:00 UTC+8 is not Dec 24 16:00Z');

// 1. Mid-year -> this year's target; the last second of Christmas Eve -> still this year.
for (const probe of ['2026-01-01T00:00:00Z', '2026-06-15T12:00:00Z', '2026-12-24T15:59:59Z', '2026-12-24T16:00:00Z']) {
  check(xmas.nextChristmas(Date.parse(probe)) === XMAS_2026, `xmas @${probe}: target != 2026-12-25 00:00 UTC+8`);
}
// 2. One second later it rolls to 2027 (+365 days).
check(xmas.nextChristmas(Date.parse('2026-12-24T16:00:01Z')) === Date.parse('2027-12-24T16:00:00Z'),
  'xmas: does not roll over just after Dec 25 00:00 UTC+8');
// 3. Host-independence is proved by the `TZ=` sweep in run-checks.sh (see the note in the week section).
// 4. Year label reads UTC+8: Dec 24 17:00Z is already Dec 25 in UTC+8.
const justAfterUtc8Midnight = Date.parse('2026-12-24T17:00:00Z');
check(xmas.christmasYear(justAfterUtc8Midnight) === 2026 && xmas.shifted(justAfterUtc8Midnight).getUTCDate() === 25,
  'xmas: UTC+8 midnight not honoured at Dec 24 17:00Z');
check(xmas.christmasYear(Date.parse('2026-12-24T15:00:00Z')) === 2026, 'xmas: year label wrong on Christmas Eve');
// 5. Season window is Nov 1 00:00 -> Dec 25 00:00 UTC+8 and brackets now, not the whole year.
const { start, end } = xmas.seasonWindow(2026);
check(start === Date.parse('2026-10-31T16:00:00Z'), 'xmas: season does not start Nov 1 00:00 UTC+8');
check(end === XMAS_2026, 'xmas: season does not end at the target');
check(end - start === 54 * DAY, `xmas: season length is ${(end - start) / DAY} days, expected 54`);
check(wall(start) === 'Sunday 00:00', 'xmas: season start does not land on midnight');

/* ───────────────────────── Daily page (21:00 → 06:00 UTC+8) ───────────────────────── */

// Day used for the daily probes: Mon 2026-09-14, so 21:00 UTC+8 == 13:00Z and 06:00 UTC+8 == 22:00Z.
const h8 = (day, hour) => Date.UTC(2026, 8, day, hour) - TZ;   // wall clock (UTC+8) -> instant
const OPEN = h8(14, 21);       // Mon 21:00 UTC+8
const CLOSE = h8(15, 6);       // Tue 06:00 UTC+8
const NEXT_OPEN = h8(15, 21);  // Tue 21:00 UTC+8

// 1. The window is exactly 9 hours: 21:00 in, 06:00 next day out.
check(CLOSE - OPEN === 9 * 3600000, 'daily: window is not 9 hours');
check(daily.atHour(OPEN, 21) === OPEN, 'daily: atHour(21) does not land on 21:00 UTC+8');
check(daily.atHour(OPEN, 6) === h8(14, 6), 'daily: atHour(6) does not land on that day 06:00 UTC+8');

// 2. Open/closed either side of both boundaries — the 06:00 end is the one that spans midnight.
for (const [label, t, inside, target] of [
  ['20:59:59', OPEN - 1000, false, OPEN],
  ['21:00:00', OPEN, true, CLOSE],
  ['23:30', h8(14, 23) + 1800000, true, CLOSE],
  ['00:00 next day', h8(15, 0), true, CLOSE],
  ['05:59:59', CLOSE - 1000, true, CLOSE],
  ['06:00:00', CLOSE, false, NEXT_OPEN],
  ['12:00', h8(15, 12), false, NEXT_OPEN],
]) {
  const n = daily.night(t);
  check(n.inside === inside, `daily ${label}: inside=${n.inside}, expected ${inside}`);
  check(n.target === target, `daily ${label}: target != expected boundary`);
  check(n.remaining === target - t, `daily ${label}: remaining wrong`);
  check(n.start <= t && t < n.start + DAY, `daily ${label}: t is not inside [start, start+1d)`);
  check(n.end - n.start === 9 * 3600000, `daily ${label}: window length wrong`);
  check(daily.shifted(n.start).getUTCHours() === 21, `daily ${label}: start is not 21:00 UTC+8`);
  check(daily.shifted(n.end).getUTCHours() === 6, `daily ${label}: end is not 06:00 UTC+8`);
  check(daily.shifted(n.end).getUTCDate() === daily.shifted(n.start).getUTCDate() + 1,
    `daily ${label}: end is not the NEXT day`);
  check(n.progress >= 0 && n.progress <= 1, `daily ${label}: progress out of range`);
}

// 3. A full 48 hours of probe: exactly one window per day, always 9h, always 21:00 -> 06:00.
let openHours = 0;
for (let i = 0; i < 48 * 60; i++) {
  const t = OPEN + i * 60000;
  const n = daily.night(t);
  if (n.inside) openHours++;
  check(daily.shifted(n.start).getUTCHours() === 21, `daily sweep: start hour != 21 at +${i}m`);
  check(daily.shifted(n.end).getUTCHours() === 6, `daily sweep: end hour != 6 at +${i}m`);
  check(n.remaining > 0 && n.remaining <= DAY, `daily sweep: remaining out of range at +${i}m`);
}
check(openHours === 18 * 60, `daily sweep: window covered ${openHours / 60}h of 48h, expected 18h`);

// 4. Host-independence is proved by the `TZ=` sweep in run-checks.sh — the model reads no local
//    fields, so there is nothing else to assert here (subtracting hours off the probe instant
//    would just probe a different instant, not a different host zone).

/* ───────────────────────── Reporting ───────────────────────── */

if (failures.length) {
  console.error('FAIL\n' + failures.slice(0, 10).join('\n') + (failures.length > 10 ? `\n… ${failures.length - 10} more` : ''));
  process.exit(1);
}
console.log('PASS — week + Christmas + night models (168h sweep, 48h sweep, boundary probes)');
