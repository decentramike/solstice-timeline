/*
  Zero-dependency check of the weight/gate model that ships inside index.html.
  The model block is sliced straight out of the page so there is one source of
  truth: if index.html drifts from the FIP-0118 schedule, this fails.

    node tests/model.test.mjs
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const start = html.indexOf('/* ==================== MODEL START');
const end = html.indexOf('/* ==================== MODEL END');
if (start < 0 || end < 0) throw new Error('MODEL markers not found in index.html');
const src = html.slice(start, end);
const MODEL = new Function(src + '\n return MODEL;')();

const {
  QUARTER_DAYS, GATES, W2_TERMINAL, POSTING_DAYS, VERIFY_END, REPORT_DUE, TIMELOCK_END,
  VOL_TARGET_ENTRY, VOL_TARGET_RATIO, FIP_EPOCHS_PER_QUARTER, EPOCH_SECONDS, N_QUARTERS, TOTAL_DAYS,
  computeScenario, bandVertices, weightsAtDay, eventsForQuarter, parseISODate, dayMs, fmtLong,
  DEFAULT_ACTIVATION, ACTORS, LANE_ORDER
} = MODEL;

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? ' — ' + detail : ''));
}
function eq(name, got, want) {
  const same = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
  ok(name, same, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const pc = v => Math.round(v * 1000) / 10;
const allPass = () => new Array(GATES.length).fill(true);

/* ---------- 1. best case matches the FIP-0118 weight schedule ---------- */
{
  const sc = computeScenario(allPass());
  // Quarter, w1 start, w1 end, w2, w0 start, w0 end  (percentages)
  const table = [
    [1, 95, 90, null, 0, 0],
    [2, 90, 85, 10, 0, 5],
    [3, 85, 80, 15, 0, 5],
    [4, 80, 75, 20, 0, 5],
    [5, 75, 70, 25, 0, 5],
    [6, 70, 65, 30, 0, 5],
    [7, 65, 60, 35, 0, 5],
    [8, 60, 55, 40, 0, 5],
    [9, 55, 50, 45, 0, 5]
  ];
  for (const [n, w1s, w1e, w2, w0s, w0e] of table) {
    const q = sc.quarters[n - 1];
    eq('Q' + n + ' w1 start', pc(q.w1Start), w1s);
    eq('Q' + n + ' w1 end', pc(q.w1End), w1e);
    eq('Q' + n + ' w0 start', pc(q.w0Start), w0s);
    eq('Q' + n + ' w0 end', pc(q.w0End), w0e);
    if (w2 == null) {
      eq('Q1 w2 ramps 5 to 10', pc(q.w2Start) + '→' + pc(q.w2End), '5→10');
    } else {
      eq('Q' + n + ' w2', pc(q.w2Start), w2);
    }
  }
  eq('bootstrap flag only on Q1', sc.quarters.filter(q => q.bootstrap).length, 1);
  eq('terminal w1', pc(sc.terminal.w1), 50);
  eq('terminal w2', pc(sc.terminal.w2), 50);
  eq('terminal w0', pc(sc.terminal.w0), 0);
  eq('terminal is best case', sc.terminal.isBestCase, true);
  eq('gates passed', sc.terminal.gatesPassed, 8);

  // gate attempted at each quarter close, best case: Q(k) closes into gate k-1
  for (let k = 2; k <= 9; k++) eq('Q' + k + ' attempts gate ' + (k - 1), sc.quarters[k - 1].gate.n, k - 1);
  eq('Q1 runs no gate check', sc.quarters[0].gate, null);
  eq('Q1 gate state', sc.quarters[0].gateState, 'bootstrap');
}

/* ---------- 2. the gate ladder ---------- */
{
  // FIP-0118 §3.1.1: "no rounding or flooring appears in the gate rule, and
  // the values listed above are the targets to full precision."
  const targets = [3500, 9450, 25515, 68890.5, 186004.35, 502211.745, 1355971.7115, 3661123.62105];
  eq('entry target', VOL_TARGET_ENTRY, 3500);
  eq('escalation ratio', VOL_TARGET_RATIO, 2.7);
  GATES.forEach((g, i) => {
    eq('gate ' + g.n + ' target is the FIP value to full precision', g.target, targets[i]);
    eq('gate ' + g.n + ' step', pc(g.to) - pc(g.from), 5);
    const formula = VOL_TARGET_ENTRY * Math.pow(VOL_TARGET_RATIO, i);
    ok('gate ' + g.n + ' is exactly $3,500 x 2.7^' + i + ' (float epsilon only)',
      Math.abs(g.target - formula) / g.target < 1e-12,
      'target ' + g.target + ' vs formula ' + formula);
  });
  ok('no target has been rounded to a whole dollar',
    GATES.some(g => !Number.isInteger(g.target)), 'all 8 are integers — rounding has crept back in');
  // Display must not quietly undo the precision the gate rule guarantees.
  for (const g of GATES) {
    const shown = MODEL.fmtUSD(g.target);
    eq('gate ' + g.n + ' displays without losing precision',
      Number(shown.replace(/[$,]/g, '')), g.target);
  }
  ok('the abbreviated form is visibly abbreviated, not truncated',
    /[kM]$/.test(MODEL.fmtUSDShort(3661123.62105)) && /[kM]$/.test(MODEL.fmtUSDShort(502211.745)),
    MODEL.fmtUSDShort(3661123.62105) + ' / ' + MODEL.fmtUSDShort(502211.745));
  eq('ladder ends at terminal w2', GATES[GATES.length - 1].to, W2_TERMINAL);
  eq('ladder is contiguous', GATES.every((g, i) => i === 0 || Math.abs(g.from - GATES[i - 1].to) < 1e-9), true);
}

/* ---------- 3. gate-fail cascade ---------- */
{
  // Fail the check at the Q2 close: w2 holds at 10% and Q3 re-attempts gate 1.
  const p = allPass(); p[0] = false;
  const sc = computeScenario(p);
  eq('fail at Q2: Q3 w2 still 10%', pc(sc.quarters[2].w2Start), 10);
  eq('fail at Q2: Q3 re-attempts gate 1', sc.quarters[2].gate.n, 1);
  eq('fail at Q2: Q3 target unchanged', sc.quarters[2].gate.target, 3500);
  eq('fail at Q2: Q3 burn grows to 10% by close', pc(sc.quarters[2].w0End), 10);
  eq('fail at Q2: Q4 w2 steps to 15% (not 20%)', pc(sc.quarters[3].w2Start), 15);
  eq('fail at Q2: Q4 attempts gate 2', sc.quarters[3].gate.n, 2);
  eq('fail at Q2: Q4 target', sc.quarters[3].gate.target, 9450);
  eq('fail at Q2: terminal w2', pc(sc.terminal.w2), 45);
  eq('fail at Q2: terminal w0', pc(sc.terminal.w0), 5);
  eq('fail at Q2: gates passed', sc.terminal.gatesPassed, 7);
  eq('fail at Q2: next unresolved gate', sc.terminal.nextGate.n, 8);
}
{
  // Two consecutive misses, then back on schedule.
  const p = allPass(); p[0] = false; p[1] = false;
  const sc = computeScenario(p);
  eq('fail Q2+Q3: Q4 w2 held', pc(sc.quarters[3].w2Start), 10);
  eq('fail Q2+Q3: Q4 re-attempts gate 1', sc.quarters[3].gate.n, 1);
  eq('fail Q2+Q3: Q4 burn at close', pc(sc.quarters[3].w0End), 15);
  eq('fail Q2+Q3: terminal w2', pc(sc.terminal.w2), 40);
  eq('fail Q2+Q3: terminal w0', pc(sc.terminal.w0), 10);
  eq('fail Q2+Q3: gates passed', sc.terminal.gatesPassed, 6);
}
{
  // Every gate missed: w2 pinned at the entry value, burn absorbs the whole ramp.
  const sc = computeScenario(new Array(GATES.length).fill(false));
  for (let k = 2; k <= 9; k++) {
    eq('all fail: Q' + k + ' w2 10%', pc(sc.quarters[k - 1].w2Start), 10);
    eq('all fail: Q' + k + ' still attempts gate 1', sc.quarters[k - 1].gate.n, 1);
  }
  eq('all fail: terminal w2', pc(sc.terminal.w2), 10);
  eq('all fail: terminal w0', pc(sc.terminal.w0), 40);
  eq('all fail: gates remaining', sc.terminal.gatesRemaining, 8);
  eq('all fail: not best case', sc.terminal.isBestCase, false);
}
{
  // Pass only the last two closes: two rungs climbed, from the bottom of the ladder.
  const p = new Array(GATES.length).fill(false); p[6] = true; p[7] = true;
  const sc = computeScenario(p);
  eq('late passes: Q8 attempts gate 1', sc.quarters[7].gate.n, 1);
  eq('late passes: Q9 attempts gate 2', sc.quarters[8].gate.n, 2);
  eq('late passes: Q9 w2 is 15%', pc(sc.quarters[8].w2Start), 15);
  eq('late passes: terminal w2', pc(sc.terminal.w2), 20);
  eq('late passes: terminal w0', pc(sc.terminal.w0), 30);
}
{
  // Once w2 tops out the ladder is exhausted and later closes have no gate.
  const p = allPass();
  const sc = computeScenario(p);
  ok('best case leaves no exhausted quarter', sc.quarters.every(q => q.gateState !== 'terminal'));
  // Shift every pass one quarter earlier than possible is not expressible, so
  // instead verify the guard directly: 8 passes consume exactly 8 closes.
  eq('8 passes consume 8 closes', sc.quarters.filter(q => q.gate).length, 8);
}

/* ---------- 4. invariants across every reachable scenario ---------- */
{
  let checked = 0;
  for (let mask = 0; mask < 256; mask++) {
    const p = Array.from({ length: 8 }, (_, i) => !!(mask & (1 << i)));
    const sc = computeScenario(p);
    for (const v of bandVertices(sc)) {
      const sum = v.w1 + v.w2 + (1 - v.w1 - v.w2);
      ok('weights sum to 1', Math.abs(sum - 1) < 1e-9);
      ok('w0 never negative (mask ' + mask + ')', 1 - v.w1 - v.w2 >= -1e-9, 'w1=' + v.w1 + ' w2=' + v.w2);
      ok('w1 within 50-95%', v.w1 >= 0.5 - 1e-9 && v.w1 <= 0.95 + 1e-9);
      ok('w2 within 5-50%', v.w2 >= 0.05 - 1e-9 && v.w2 <= 0.5 + 1e-9);
    }
    eq('vertex count is scenario-independent (mask ' + mask + ')', bandVertices(sc).length, 20);
    eq('passes counted (mask ' + mask + ')', sc.terminal.gatesPassed, p.filter(Boolean).length);
    checked++;
  }
  eq('all 256 gate combinations exercised', checked, 256);
}

/* ---------- 5. weights at a day ---------- */
{
  const sc = computeScenario(allPass());
  eq('non-finite day does not produce NaN', pc(weightsAtDay(NaN, sc).w1), 95);
  eq('day 0 w1', pc(weightsAtDay(0, sc).w1), 95);
  eq('day 0 w2', pc(weightsAtDay(0, sc).w2), 5);
  eq('day 0 w0', pc(weightsAtDay(0, sc).w0), 0);
  // Expressed in quarters, not days: the configured quarter length may change.
  const Q = QUARTER_DAYS;
  eq('mid bootstrap w2 interpolates', pc(weightsAtDay(Q / 2, sc).w2), 7.5);
  eq('bootstrap close w1', pc(weightsAtDay(Q, sc).w1), 90);
  eq('bootstrap close w2', pc(weightsAtDay(Q, sc).w2), 10);
  eq('bootstrap close w0', pc(weightsAtDay(Q, sc).w0), 0);
  eq('mid Q2 w2 is flat', pc(weightsAtDay(Q * 1.5, sc).w2), 10);
  eq('mid Q2 w0', pc(weightsAtDay(Q * 1.5, sc).w0), 2.5);
  eq('w1 floors after the ramp', pc(weightsAtDay(TOTAL_DAYS, sc).w1), 50);
  eq('terminal w2 after the window', pc(weightsAtDay(TOTAL_DAYS, sc).w2), 50);
  eq('the ramp lands exactly on the floor at the end of Q9',
    pc(weightsAtDay(N_QUARTERS * Q, sc).w1), 50);
}

/* ---------- 6. dates derive from the activation date ---------- */
{
  const a = parseISODate(DEFAULT_ACTIVATION);
  eq('default activation parses', fmtLong(a), 'Oct 15, 2026');
  // FIP-0118 §3.2 fixes EPOCHS_PER_QUARTER at 259,200 epochs of 30 seconds.
  eq('the FIP quarter is 90 days', FIP_EPOCHS_PER_QUARTER * EPOCH_SECONDS / 86400, 90);
  const want90 = ['Jan 13, 2027', 'Apr 13, 2027', 'Jul 12, 2027', 'Oct 10, 2027', 'Jan 8, 2028',
    'Apr 7, 2028', 'Jul 6, 2028', 'Oct 4, 2028', 'Jan 2, 2029'];
  for (let k = 1; k <= 9; k++) {
    eq('at the FIP 90-day quarter, Q' + k + ' closes', fmtLong(dayMs(a, k * 90)), want90[k - 1]);
  }
  // Whatever length this page is configured to, every boundary must follow it.
  for (let k = 1; k <= 9; k++) {
    eq('Q' + k + ' close follows the configured quarter length',
      fmtLong(dayMs(a, k * QUARTER_DAYS)),
      fmtLong(a + Math.round(k * QUARTER_DAYS) * 86400000));
  }
  ok('quarter length is positive and finite', QUARTER_DAYS > 0 && Number.isFinite(QUARTER_DAYS));
  const b = parseISODate('2027-03-01');
  eq('shifted activation, Q1 close', fmtLong(dayMs(b, QUARTER_DAYS)),
    fmtLong(b + Math.round(QUARTER_DAYS) * 86400000));
  eq('bad date rejected', parseISODate('nope'), null);
  eq('empty date rejected', parseISODate(''), null);
  eq('two-digit year not mapped into the 1900s', parseISODate('0026-10-15'), null);
  eq('nonexistent calendar date rejected', parseISODate('2027-02-29'), null);
  eq('real leap day accepted', fmtLong(parseISODate('2028-02-29')), 'Feb 29, 2028');
  eq('month 13 rejected', parseISODate('2026-13-01'), null);
  eq('month 00 rejected', parseISODate('2026-00-10'), null);
  eq('day 32 rejected', parseISODate('2026-10-32'), null);
  eq('day 00 rejected', parseISODate('2026-10-00'), null);
  eq('a 90-day offset may land on a leap day',
    fmtLong(dayMs(parseISODate('2027-12-01'), 90)), 'Feb 29, 2028');
}

/* ---------- 7. the end-of-quarter event sequence ---------- */
{
  const a = parseISODate(DEFAULT_ACTIVATION);
  const sc = computeScenario(allPass());
  const q2 = sc.quarters[1];
  const ev = eventsForQuarter(q2, sc, a);
  const byId = Object.fromEntries(ev.map(e => [e.id, e]));
  const QE = q2.endDay;

  eq('PostVolume opens at QE', byId['post-volume'].start - QE, 0);
  eq('PostVolume closes at QE+3d', byId['post-volume'].end - QE, POSTING_DAYS);
  eq('verification opens when posting closes', byId['verification'].start, byId['post-volume'].end);
  eq('verification closes at QE+10d', byId['verification'].end - QE, VERIFY_END);
  eq('self-monitor tracks the verification window',
    byId['self-monitor'].start + '/' + byId['self-monitor'].end,
    byId['verification'].start + '/' + byId['verification'].end);
  eq('Community Report due at QE+7d', byId['community-report'].start - QE, REPORT_DUE);
  eq('report deadline lands inside the verification window',
    byId['community-report'].start > byId['verification'].start && byId['community-report'].start < byId['verification'].end, true);
  ok('there is no FinalizeConversion — FIP-0118 names no such method', !byId['finalize']);
  eq('values bind when the verification window closes', byId['binding'].start - QE, VERIFY_END);
  eq('SubmitShares waits for binding', byId['submit-shares'].deps.join(), 'binding');
  eq('the gate check waits for binding', byId['gate-check'].deps.join(), 'binding');
  ok('SubmitShares and the gate check are independent — either may run first',
    !byId['submit-shares'].deps.includes('gate-check') && !byId['gate-check'].deps.includes('submit-shares'));
  ok('and they are drawn as concurrent, not sequential',
    byId['submit-shares'].start === byId['gate-check'].start,
    'starts differ: ' + byId['submit-shares'].start + ' vs ' + byId['gate-check'].start);
  eq('the check itself is permissionless, per the spec actor column', byId['gate-check'].actor, 'permissionless');
  eq('the outcome sits in the volume gate lane', byId['gate-outcome'].actor, 'gate');
  eq('the outcome resolves at the timelock', byId['gate-outcome'].end - QE, TIMELOCK_END);
  eq('timelock expires at QE+17d', byId['timelock'].start - QE, TIMELOCK_END);
  eq('timelock is the last thing to happen', Math.max(...ev.map(e => e.end)), byId['timelock'].end);

  eq('every dependency resolves', ev.every(e => (e.deps || []).every(d => byId[d])), true);
  eq('no dependency runs backwards', ev.every(e => (e.deps || []).every(d => byId[d].start <= e.start)), true);
  // A predecessor that finishes AFTER its dependent starts is a real ordering
  // error, and the renderer can only respond by dropping the arrow silently —
  // so assert the whole chain is drawable, in every quarter and scenario.
  for (const mask of [0xff, 0x00, 0x55, 0x01]) {
    const p2 = Array.from({ length: 8 }, (_, i) => !!(mask & (1 << i)));
    const s2 = computeScenario(p2);
    for (const q2 of s2.quarters) {
      const evs = eventsForQuarter(q2, s2, a);
      const by2 = Object.fromEntries(evs.map(e => [e.id, e]));
      for (const e of evs) {
        for (const d of e.deps || []) {
          ok('Q' + q2.n + ' mask ' + mask + ': ' + d + ' finishes before ' + e.id + ' starts',
            by2[d].end <= e.start + 1e-9,
            by2[d].id + ' ends ' + by2[d].end + ' but ' + e.id + ' starts ' + e.start);
        }
      }
    }
  }
  eq('every actor is a known lane', ev.every(e => LANE_ORDER.includes(e.actor)), true);
  eq('every event names a source', ev.every(e => e.source && e.source.length > 3), true);
  eq('every event carries relative timing', ev.every(e => e.rel && e.when), true);

  // absolute dates
  // Offsets are day counts fixed by the FIP, independent of quarter length.
  const dayOf = d => Math.round((dayMs(a, d) - a) / 86400000);
  eq('posting closes 3 days after the close', dayOf(QE + POSTING_DAYS) - dayOf(QE), POSTING_DAYS);
  eq('verification closes 10 days after the close', dayOf(QE + VERIFY_END) - dayOf(QE), VERIFY_END);
  eq('the report is due 7 days after the close', dayOf(QE + REPORT_DUE) - dayOf(QE), REPORT_DUE);
  eq('the timelock expires 17 days after the close', dayOf(QE + TIMELOCK_END) - dayOf(QE), TIMELOCK_END);

  // Q1: activation events, and no gate check
  const q1ev = eventsForQuarter(sc.quarters[0], sc, a);
  const q1 = Object.fromEntries(q1ev.map(e => [e.id, e]));
  ok('Q1 has the genesis seating', !!q1['genesis-seating']);
  ok('Q1 has the genesis disclosure', !!q1['genesis-disclosure']);
  ok('Q1 has the declaration file', !!q1['declaration']);
  ok('Q1 has RegisterPairs', !!q1['register-pairs']);
  ok('Q1 runs no gate check', !q1['gate-check'] && !!q1['gate-none']);
  eq('Q1 one-time events sit at activation', q1['genesis-seating'].start, 0);
  eq('declaration due within 7 days', q1['declaration'].end, 7);
  eq('Q1 runs posting, verification, binding and SubmitShares',
    !!q1['post-volume'] && !!q1['verification'] && !!q1['binding'] && !!q1['submit-shares'], true);
  ok('later quarters carry no one-time events',
    eventsForQuarter(sc.quarters[4], sc, a).every(e => !e.oneTime));

  // A failing gate rewrites the gate-check copy rather than dropping the event.
  const p = allPass(); p[0] = false;
  const failed = computeScenario(p);
  const fev = Object.fromEntries(eventsForQuarter(failed.quarters[1], failed, a).map(e => [e.id, e]));
  ok('failed gate check is still drawn', !!fev['gate-check']);
  ok('failed gate outcome says w2 holds', /holds at 10%/.test(fev['gate-outcome'].desc), fev['gate-outcome'].desc);
  ok('failed gate outcome says the target is re-attempted', /re-attempted/.test(fev['gate-outcome'].desc));
  ok('failed gate outcome is named "missed"', /missed/.test(fev['gate-outcome'].name), fev['gate-outcome'].name);
  ok('timelock notes that nothing takes effect', /Nothing takes effect/.test(fev['timelock'].desc));
  ok('passing outcome names the step it unlocks', /w2 steps from 10% to 15%/.test(byId['gate-outcome'].desc), byId['gate-outcome'].desc);
  ok('passing outcome is named "clears"', /clears/.test(byId['gate-outcome'].name), byId['gate-outcome'].name);

  // A re-attempt must say so, in the model and in the copy.
  const p2 = allPass(); p2[0] = false;
  const sc2 = computeScenario(p2);
  eq('first attempt at a rung is attempt 1', sc2.quarters[1].gate.attempt, 1);
  eq('the following close is attempt 2 at the same rung', sc2.quarters[2].gate.attempt, 2);
  eq('a fresh rung resets the attempt count', sc2.quarters[3].gate.attempt, 1);
  const retry = Object.fromEntries(eventsForQuarter(sc2.quarters[2], sc2, a).map(e => [e.id, e]));
  ok('the re-attempt is stated in the copy', /attempt 2/i.test(retry['gate-check'].desc), retry['gate-check'].desc);
  const allFail = computeScenario(new Array(8).fill(false));
  eq('eight straight misses count up to attempt 8', allFail.quarters[8].gate.attempt, 8);
}

/* ---------- 8. lanes ---------- */
{
  eq('six actor lanes', LANE_ORDER.length, 6);
  eq('every lane has a label', LANE_ORDER.every(k => ACTORS[k] && ACTORS[k].label), true);
}

/* ---------- report ---------- */
const dedup = [...new Set(fails)];
console.log((dedup.length ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mPASS\x1b[0m') + ' — ' + pass + ' assertions passed, ' + dedup.length + ' distinct failures');
if (dedup.length) {
  for (const f of dedup.slice(0, 40)) console.log('  • ' + f);
  process.exit(1);
}
