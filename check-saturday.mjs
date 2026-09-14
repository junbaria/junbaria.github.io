// Checker for the week model shipped in saturday.html. Run: node check-saturday.mjs
// Extracts the real <script> block from the file and re-evaluates it, so the check
// can never agree with a stale copy of the logic.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./saturday.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (blocks.length !== 2) throw new Error(`expected 2 <script> blocks, found ${blocks.length}`);
const { cycle, countdown, weekStart, fmtLocal } = await import(
  'data:text/javascript,' + encodeURIComponent(blocks[0] + '\nexport { cycle, countdown, weekStart, fmtLocal };')
);

const TZ = 8 * 3600 * 1000;
const DAY = 86400000;
// The week containing Mon 2026-09-14 00:00 UTC+8 (= Sun 16:00Z).
const MON = Date.parse('2026-09-13T16:00:00Z');
const at = (label, ms) => ({ label, ms });

const failures = [];

// ICU punctuation varies by Node build — compare comma-stripped weekday + time.
const wall = (t) => fmtLocal(t, { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/,/g, '');

// 1. The reset boundary is exactly Monday 00:00 UTC+8, for every hour of the week.
for (let h = 0; h < 7 * 24; h++) {
  const t = MON + h * 3600000;
  const { reset } = cycle(t);
  if (reset !== MON + 7 * DAY) failures.push(`h=${h}: reset != next Monday 00:00 UTC+8`);
  if (wall(reset) !== 'Monday 00:00') failures.push(`h=${h}: reset renders as ${wall(reset)}`);
  if (cycle(weekStart(t)).start !== MON) failures.push(`h=${h}: week is not Mon 00:00 → next Mon`);
}

// 2. The Saturday boundary lands at Sat 23:59:59 UTC+8 and ticks to zero there, not a day early.
const { saturdayEnd } = cycle(MON);
if (saturdayEnd !== MON + 6 * DAY) failures.push('saturdayEnd is not Sun 00:00 UTC+8');
if (wall(saturdayEnd - 1000) !== 'Saturday 23:59') {
  failures.push('last second is not Saturday 23:59 UTC+8');
}
for (const probe of [
  at('sat 12:00', MON + 5 * DAY + 12 * 3600000),
  at('sat 23:59:59', MON + 6 * DAY - 1000),
]) {
  const r = countdown(probe.ms);
  if (r.pastSaturday) failures.push(`${probe.label}: flagged as past Saturday`);
  if (r.target !== saturdayEnd) failures.push(`${probe.label}: target is not Saturday`);
  if (r.remaining !== saturdayEnd - probe.ms) failures.push(`${probe.label}: remaining wrong`);
}
const lastSecond = countdown(MON + 6 * DAY - 1000);
if (lastSecond.remaining !== 1000) failures.push(`sat last second: remaining ${lastSecond.remaining} != 1000`);

// 3. Monday's reset starts the next Saturday's countdown; never a negative or Sunday target.
for (let h = 0; h < 7 * 24; h++) {
  const r = countdown(MON + h * 3600000);
  if (r.remaining < 0 || r.remaining > 7 * DAY) failures.push(`h=${h}: remaining out of range`);
  if (r.progress < 0 || r.progress > 1) failures.push(`h=${h}: progress out of range`);
  if (!r.pastSaturday && r.target !== MON + 6 * DAY) failures.push(`h=${h}: target not this Saturday`);
  if (r.pastSaturday && r.target !== MON + 7 * DAY) failures.push(`h=${h}: sunday target not the reset`);
}
const reset = MON + 7 * DAY;
const sun = countdown(MON + 6 * DAY + 3600000);   // Sun 01:00 UTC+8
if (!sun.pastSaturday || sun.target !== reset) failures.push('Sunday: does not count to the Monday reset');
if (sun.remaining !== reset - (MON + 6 * DAY + 3600000)) failures.push(`Sunday: remaining ${sun.remaining} != 23h`);
const mon = countdown(MON);
if (mon.pastSaturday || mon.remaining !== 6 * DAY) failures.push('Monday 00:00 does not start a fresh 6-day cycle');

// 4. Host-independent: the boundaries are the same from any local zone.
for (const tzOff of [0, -7, 5.5]) {
  const r = cycle(MON + 3 * DAY - tzOff * 3600000);
  if (r.reset !== MON + 7 * DAY || r.saturdayEnd !== MON + 6 * DAY) failures.push(`tz offset ${tzOff}: shifted boundaries`);
}

if (failures.length) {
  console.error('FAIL\n' + failures.slice(0, 10).join('\n') + (failures.length > 10 ? `\n… ${failures.length - 10} more` : ''));
  process.exit(1);
}
console.log('PASS — Saturday ends Sun 00:00 UTC+8, reset every Monday 00:00 UTC+8 (168 hours checked)');
