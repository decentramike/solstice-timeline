# Solstice Timeline

An interactive timeline of the FIP-0118 ("Solstice") block-reward split: the nine-quarter weight
schedule, the volume gates that unlock each step, and the reporting and governance sequence that runs
at every quarter close. One static HTML file, no build step, no dependencies, no network calls.

## What FIP-0118 is

FIP-0118 replaces the Fil+ program with a three-way split of the block reward: **w1** to consensus,
**w2** to service (paid to the Orchestrator), and **w0** burned. From activation the split evolves over
roughly nine quarters — w1 ramps down continuously on a fixed schedule from 95% to 50%, while w2 steps
up 5 percentage points at a quarter close only if that quarter's settlement volume clears a fixed USD
target. w0 is the remainder (`w0 = 1 − w1 − w2`), so a missed gate does not stall the ramp: w1 keeps
falling, w2 holds, and the difference burns. Each quarter close triggers a strict sequence of on-chain
reporting, verification and governance actions with hard deadlines.

## What the timeline shows

- **Weight evolution** — a stacked area chart of w1/w2/w0 across all nine quarters plus the terminal
  state, with a gate marker at each quarter close.
- **A scenario builder** — every gate has a clears/missed toggle. Flipping one holds w2 from that close
  onward, grows the burn band, and re-attempts *the same target* at the next close. The gate ladder is
  keyed to w2's current value, not to the quarter number, so a miss delays the schedule without ever
  skipping a rung. The terminal state and the burn peak update live. Full state lives in the URL, so a
  scenario can be shared as a link.
- **The quarter close cycle** — pick any quarter to get a Gantt of its close sequence across six actor
  lanes (Protocol/f02, Orchestrator, SRA Governance, SWA Governance, Permissionless, Volume Gate), with
  the dependency chain drawn: PostVolume → verification window → FinalizeConversion → SubmitShares →
  QuarterlyGateCheck → SWA confirmation → SWA_TIMELOCK expiry. Q1 also shows the one-time activation
  events. Every event carries its actor, dates, description and source.
- **Standing obligations** that are not bound to a quarter, and the assumptions behind everything above.

Both charts have text equivalents: a live weight-schedule table under the chart and a per-quarter event
table under the Gantt, both reflecting the current scenario.

## Dates are assumptions, not protocol

**October 15, 2026 is a planning placeholder.** FIP-0118 names no activation date or epoch. Change the
activation date in the header and every date on the page — quarter boundaries, deadlines, timelock
expiries — moves with it.

Quarters are modelled as **90 days**. Real quarter length is set by `EPOCHS_PER_QUARTER`, so actual
boundaries will drift from these dates.

The **3-day posting period, 7-day verification window and 7-day SWA_TIMELOCK are proposed
governance-repo values, not parameters of the FIP.** Of the three, only SWA_TIMELOCK is enforced at L1.
The Community Report deadline (7 days after a close) comes from governance repo doc 04 and overlaps the
verification window. All of this is restated in the page's own Assumptions panel.

Two further simplifications, also stated on the page:

- Ordering **within** the post-verification window is indicative. Events after QE+10d are drawn dashed
  and in dependency order; the FIP sets no per-step deadline between QE+10d and the timelock expiry.
- w2 steps are drawn **at the quarter boundary**. In practice a clearing gate is written to f02 after
  QE+10d and only takes effect when SWA_TIMELOCK expires, roughly QE+17d.

## Data sources

- FIP-0118, as of August 2026.
- Solstice governance repo docs 02, 03 and 04 — posting period, verification window, SRA and SWA duties,
  and the Community Report obligation.
- PR #1279 (transparency rules), in Draft as of August 2026. The genesis Orchestrator disclosure and the
  Community Report obligations shown here depend on it merging.

Exact URLs are deliberately not baked into this file. Add them when it lands in the governance repo.

The eight gate targets are the values fixed at FIP time: $3,500, $9,450, $25,515, $68,891, $186,005,
$502,213, $1,355,976, $3,661,135. `$3,500 × 2.7^n` (where `n = (w2 − 10%) / 5%`) reproduces them to
within about 7 parts per million but not exactly, so the published integers are what the page uses.

## Running it

Open `index.html` in a browser. That is the whole procedure — it works from the filesystem.

To serve it locally instead:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173/>.

## Deploying to GitHub Pages

Push the repo and enable Pages on the branch and folder holding `index.html`:

```bash
git remote add origin git@github.com:<org>/<repo>.git
git push -u origin main
```

Then in **Settings → Pages**, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
To publish from a `gh-pages` branch instead:

```bash
git subtree push --prefix . origin gh-pages
```

No `.nojekyll` file is needed — there are no underscore-prefixed paths.

## Linking and embedding

The page reads its whole state from the URL, so a link can open a specific scenario:

```
index.html?theme=dark#q=5&d=2026-10-15&g=10011111
```

| Parameter | Effect |
| --- | --- |
| `?embed=1` | Trims the header for iframe embedding |
| `?theme=light` \| `?theme=dark` | Forces a theme; otherwise follows the OS setting and the in-page toggle |
| `?density=projector` | Starts in the larger projector type scale |
| `#q=<1–10>` | Selected quarter; `10` is the terminal state |
| `#d=<YYYY-MM-DD>` | Activation date |
| `#g=<8 chars>` | Gate outcomes at the Q2…Q9 closes, `1` clears and `0` missed. Exactly 8 characters |

To embed it in a governance-repo page:

```html
<iframe src="https://<org>.github.io/<repo>/?embed=1#q=2"
        title="FIP-0118 Solstice reward split timeline"
        width="100%" height="1400" loading="lazy" style="border:0"></iframe>
```

The "Copy link to this scenario" button in the footer copies the current URL, including the scenario.

## Tests

```bash
node tests/model.test.mjs
node tests/dom.test.mjs
```

Both are dependency-free and need only Node.

`model.test.mjs` slices the model block straight out of `index.html`, so there is a single source of
truth, then checks it against the FIP-0118 schedule: every quarter's w1/w2/w0 start and end, the gate
ladder, the fail-and-re-attempt cascade, invariants across all 256 gate-outcome combinations, the
end-of-quarter event sequence, and every derived date (including leap-day activations and quarter closes
that land on February 29).

`dom.test.mjs` is a static wiring check: every element id the script reaches for exists in the markup,
no duplicate ids, every ARIA reference and in-page anchor resolves, and nothing external has crept in
(no script `src`, no stylesheet `link`, no webfont, no `fetch`).

## Accessibility

Keyboard reachable throughout, with arrow-key navigation across the quarter strip and Escape to dismiss
tooltips and release a pinned event. Scenario changes are announced through a single polite live region.
The charts carry text alternatives rather than relying on colour, pass/fail always carries a glyph and a
hatch as well as a colour, and the palette was checked for WCAG contrast in both themes and for
greyscale and colour-blind separability. Focus is deliberately restored after each re-render, since
every scenario change rebuilds the controls.

## Deliberate deviations from the original brief

- **Linked panes with click-to-drill, rather than continuous semantic zoom.** The macro chart and the
  quarter Gantt are separate, always-visible panes; clicking a quarter (or a chip, or the arrow keys)
  drills in. The time axis itself zooms and pans (pinch or shift-scroll to zoom, drag to pan,
  double-click to reset). A single continuously-zooming canvas was traded away for something that
  survives a projector, a trackpad and a keyboard.
- **QuarterlyGateCheck sits in the Permissionless lane**, matching the brief's actor column. The Volume
  Gate lane carries the gate *outcome* — the scenario-dependent part, which is also the toggle.
- **Q2's burn column reads 0%→5%, not the brief's 5%→10%.** With w1 at 90%→85% and w2 at 10%,
  `1 − w1 − w2` is 0%→5%; the printed 5%→10% would require w2 = 5% during Q2, which contradicts the same
  table's own w2 column, the bootstrap ramp ending at 10%, and the rule that w2 only increases.
- **Q9's w2 is flat at 45%**, stepping to 50% at the close. A 45%→50% ramp through Q9 would make w0 zero
  throughout, contradicting that row's own 0%→5% burn column and the terminal 50/50/0 state.
