/**
 * Output: what goes on each line, and in what order.
 *
 * The terminal view does one thing: it makes the reason a route was flagged
 * readable without opening anything else. So every result shows the two
 * responses that produced it and the command that explains it.
 *
 * One exception to that, deliberately. A byte-identical successful response
 * across a session boundary is not a score to be read and weighed, it is a
 * thing to go and check, so it gets a box and skips the arithmetic entirely.
 *
 * Drawing primitives live in `ink.ts`. What follows is only the layout. The
 * same functions produce plain output: the caller hands them an `Ink` with no
 * colour and no links, and every escape falls out of the same code path.
 */
import {COMMAND_NAME, DESCRIPTION, logo, TAGLINE} from '../brand.js';
import {CONTROL_PROFILE} from '../core/config.js';
import {errorMessage, GatecrashError} from '../core/errors.js';
import type {
  CheckResult,
  ComparisonOutcome,
  Confidence,
  Finding,
  GatecrashReport,
  InspectionResult,
  RouteReport,
} from '../core/types.js';
import {formatDuration, listOf, plural} from '../utils/format.js';
import {terminalText} from '../utils/security.js';
import {VERSION} from '../version.js';
import {
  duration,
  gauge,
  page,
  pad,
  panel,
  rail,
  padStart,
  shorten,
  visible,
  wrap,
  type Glyphs,
  type Ink,
} from './ink.js';

// Left margin, coloured rail, space. Everything inside a result block hangs
// off column four.
const INDENT = 4;

// Which palette entry an outcome speaks in. Ordered worst first: the first
// outcome a route carries from this list decides the colour of its rail.
const TONES: Record<ComparisonOutcome, string> = {
  review: 'review',
  error: 'error',
  inconclusive: 'unclear',
  changed: 'changed',
  same: 'changed',
  public: 'dim',
  blocked: 'blocked',
};

const SEVERITY: ComparisonOutcome[] = [
  'review',
  'error',
  'inconclusive',
  'changed',
  'same',
  'public',
  'blocked',
];

/**
 * Every mark is distinct without colour, because colour is allowed to support
 * a label here and never to carry it. A reader with `NO_COLOR=1` still has to
 * be able to tell a door that held from one that did not, and a door that was
 * never shut from either.
 */
const MARKS: Record<string, [string, string]> = {
  baseline: ['●', 'o'],
  review: ['!', '!'],
  blocked: ['✓', '+'],
  same: ['=', '='],
  changed: ['≠', '~'],
  public: ['○', '-'],
  inconclusive: ['?', '?'],
  error: ['×', 'x'],
};

const CONFIDENCE_TONES: Record<Confidence, string> = {
  high: 'review',
  medium: 'unclear',
  low: 'changed',
};

function markFor(name: string, glyph: Glyphs): string {
  const pair = MARKS[name] ?? MARKS.inconclusive;
  return (glyph.rail === '▌' ? pair?.[0] : pair?.[1]) ?? '?';
}

function worstOutcome(route: RouteReport): ComparisonOutcome {
  for (const outcome of SEVERITY) {
    if (route.comparisons.some((comparison) => comparison.outcome === outcome)) {
      return outcome;
    }
  }
  return 'blocked';
}

function safe(value: string): string {
  return terminalText(value);
}

/**
 * `label  subject ────────  meta`. The rule is what separates the header from
 * the report without spending a line on a box.
 */
function ruleLine(label: string, subject: string, meta: string, ink: Ink, span: number): string {
  // The subject is the first part to give. The label says which command is
  // speaking and the meta says what it did, and a header that drops either to
  // keep an origin whole has kept the wrong thing.
  const room = span - label.length - meta.length - 10;
  const shown = subject === '' ? '' : shorten(subject, Math.max(8, room), ink);
  const head = shown === ''
    ? ink.paint(label, 'accent', 'bold')
    : `${ink.paint(label, 'accent', 'bold')}  ${ink.paint(shown, 'dim')}`;
  // Once the subject has given everything it has, the meta gives too, because
  // the alternative is a header that runs past the edge. `fill` was floored at
  // two, which held the rule together and let the line overflow instead: at
  // sixty columns a header with four counts in it ran sixteen characters past.
  // Callers with droppable counts should drop whole ones before it comes to
  // this, so a number is never shown cut in half.
  const fitted = shorten(meta, Math.max(0, span - visible(head) - 10), ink);
  const fill = Math.max(2, span - visible(head) - visible(fitted) - 8);
  return `  ${head} ${ink.paint(ink.glyph.line.repeat(fill), 'dim')}  ${ink.paint(fitted, 'dim')}`;
}

/** Whole counts, dropped from the end until what is left fits. */
function fitMeta(parts: string[], separator: string, room: number): string {
  for (let count = parts.length; count > 1; count -= 1) {
    const candidate = parts.slice(0, count).join(separator);
    if (candidate.length <= room) {
      return candidate;
    }
  }
  return parts[0] ?? '';
}

/**
 * Painted parts packed into lines, wrapping at whole parts.
 *
 * A count broken across a line break stops being a count, and a count sliced
 * by `shorten` stops being true, so the break goes between them. Continuation
 * lines are indented to the column the first one started at.
 */
function packParts(parts: string[], separator: string, lead: string, span: number): string[] {
  const indent = ' '.repeat(visible(lead));
  const lines: string[] = [];
  let current = '';

  for (const part of parts) {
    const candidate = current === '' ? part : current + separator + part;
    const prefix = lines.length === 0 ? lead : indent;
    if (current !== '' && visible(prefix) + visible(candidate) > span) {
      lines.push(prefix + current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    lines.push((lines.length === 0 ? lead : indent) + current);
  }
  return lines;
}

/**
 * The one case that gets to interrupt: a response that came back byte for byte
 * identical to a session that was not the baseline. A box, used exactly once.
 * If everything is boxed then nothing is.
 */
function alarm(report: GatecrashReport, ink: Ink, span: number): string[] {
  // High confidence only. The box used to fire on any byte-identical match,
  // which meant it fired on `{"items":[],"total":0}` — the reply half the
  // endpoints in a capture give a fresh account, identical for every caller
  // alive. A box that goes off for that is a box nobody reads.
  const high = report.findings.filter((finding) => finding.confidence === 'high');
  if (high.length === 0) {
    return [];
  }

  const sessions = [...new Set(high.flatMap((finding) =>
    finding.crossings.map((crossing) => crossing.challenger)))].map(safe);
  const named = sessions.length > 3
    ? `${sessions.slice(0, 3).join(', ')} and ${sessions.length - 3} more`
    : listOf(sessions);
  const body = `${plural(high.length, 'route')} returned a byte-identical successful response to `
    + `${named}, and that response carries data specific to ${safe(report.config.baseline)}. `
    + 'Check each against the access policy the application is supposed to enforce, then treat '
    + 'what is left as a finding.';

  const wrapped = wrap(body, span - 8).map((line) => ink.paint(line, 'review'));
  return [...panel('EXACT MATCH', wrapped, ink, 'review', span), ''];
}

/**
 * One sentence naming the worst thing in the run, in plain English.
 *
 * Every count here is of routes, and says so. The old version counted exact
 * findings and called them sessions, so a five-route run against two sessions
 * opened with "5 sessions received responses they should have had to earn."
 */
export function headline(report: GatecrashReport): string {
  const {summary} = report;
  if (summary.high > 0) {
    return `${plural(summary.high, 'route')} returned data belonging to `
      + `${report.config.baseline} to a session that should not have had it.`;
  }
  if (summary.medium > 0) {
    return `${plural(summary.medium, 'route')} came back close enough to the baseline to be `
      + 'worth checking.';
  }
  if (summary.low > 0) {
    return `${plural(summary.low, 'route')} matched, but on responses too empty to prove `
      + 'anything either way.';
  }
  if (summary.errors > 0) {
    return `${plural(summary.errors, 'request')} failed, so those routes were never compared.`;
  }
  return '';
}

function cell(
  report: GatecrashReport,
  route: RouteReport,
  profile: string,
  ink: Ink,
): {text: string; tone: string} {
  const response = route.responses.find((item) => item.profile === profile);
  if (response?.error !== undefined) {
    return {text: `ERR ${markFor('error', ink.glyph)}`, tone: 'error'};
  }

  const status = response?.status === undefined ? '—' : String(response.status);
  if (profile === report.config.baseline) {
    const healthy = response?.status !== undefined && response.status >= 200 && response.status < 300;
    return {text: `${status} ${markFor('baseline', ink.glyph)}`, tone: healthy ? 'accent' : 'unclear'};
  }

  const comparison = route.comparisons.find((item) => item.challenger === profile);
  const outcome = comparison?.outcome ?? 'inconclusive';
  return {text: `${status} ${markFor(outcome, ink.glyph)}`, tone: TONES[outcome]};
}

/**
 * A row of the map.
 *
 * One route, unless several routes are the same endpoint with a different
 * identifier in it — a capture of a paginated list is two hundred of those,
 * and printing them one per line is how the map stopped being something you
 * read. The family is shown by its pattern, carrying the worst result any
 * member of it produced.
 */
interface MapRow {
  method: string;
  label: string;
  count: number;
  route: RouteReport;
  outcome: ComparisonOutcome;
}

function mapRows(report: GatecrashReport): MapRow[] {
  const grouped = new Map<string, RouteReport[]>();
  for (const route of report.routes) {
    const key = `${route.method}\n${route.pattern}`;
    grouped.set(key, [...grouped.get(key) ?? [], route]);
  }

  const rows: MapRow[] = [];
  for (const members of grouped.values()) {
    // The member that decides the row is the worst one, so folding a family
    // can only ever promote a result up the page, never bury one.
    const ordered = [...members].sort((left, right) =>
      SEVERITY.indexOf(worstOutcome(left)) - SEVERITY.indexOf(worstOutcome(right))
      || left.path.localeCompare(right.path));
    const worst = ordered[0];
    if (worst === undefined) {
      continue;
    }
    rows.push({
      method: worst.method,
      label: members.length === 1 ? worst.path : worst.pattern,
      count: members.length,
      route: worst,
      outcome: worstOutcome(worst),
    });
  }

  return rows.sort((left, right) =>
    SEVERITY.indexOf(left.outcome) - SEVERITY.indexOf(right.outcome)
    || left.label.localeCompare(right.label));
}

/** Sessions with columns: the baseline and its challengers, never the control. */
function mapProfiles(report: GatecrashReport): string[] {
  return report.config.profiles
    .filter(({name}) => name !== CONTROL_PROFILE)
    .map(({name}) => name);
}

// Past this the map has stopped being something you read and started being
// something you scroll. Never silently: the line below says how many were held
// back and where the rest of them are.
const MAP_ROWS_WIDE = 16;
const MAP_ROWS_NARROW = 8;

function legend(ink: Ink, span: number): string[] {
  const g = ink.glyph;
  const entries: Array<[string, string]> = [
    ['baseline', 'dim'],
    ['review', 'review'],
    ['blocked', 'blocked'],
    ['changed', 'changed'],
    ['public', 'dim'],
    ['inconclusive', 'unclear'],
  ];
  const separator = ink.paint(`  ${g.sep}  `, 'dim');
  const lines: string[] = [];
  let current = '';
  for (const [name, tone] of entries) {
    const part = ink.paint(`${markFor(name, g)} ${name}`, tone);
    const candidate = current === '' ? part : current + separator + part;
    // A legend that wraps on its own is worse than one that wraps where it was
    // told to: the second line lands in column zero and stops reading as a key.
    if (current !== '' && visible(candidate) + 2 > span) {
      lines.push(`  ${current}`);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    lines.push(`  ${current}`);
  }
  return lines;
}

/**
 * Wide terminals get profile columns, because reading across a row is how you
 * see one route treated differently by two sessions. Narrow terminals get the
 * same information stacked, because a table folded into forty columns is not a
 * table.
 */
function accessMap(report: GatecrashReport, ink: Ink, span: number): string[] {
  const profiles = mapProfiles(report);
  const rows = mapRows(report);
  const stacked = span < 78 || profiles.length > 4;
  const shown = rows.slice(0, stacked ? MAP_ROWS_NARROW : MAP_ROWS_WIDE);
  const hidden = rows.length - shown.length;
  const g = ink.glyph;
  const folded = rows.some((row) => row.count > 1);

  const lines = [ruleLine(
    'access map',
    '',
    `${plural(rows.length, folded ? 'endpoint' : 'route')} ${g.sep} `
    + `${plural(profiles.length, 'session')}`,
    ink,
    span,
  ), ''];

  const tally = (row: MapRow): string => row.count === 1 ? '' : ` ×${row.count}`;

  if (stacked) {
    for (const row of shown) {
      const tone = TONES[row.outcome];
      const bar = `  ${rail(ink, tone)} `;
      lines.push(`${bar}${ink.paint(safe(row.method), 'dim')} `
        + shorten(safe(row.label), Math.max(20, span - INDENT - 8), ink)
        + ink.paint(tally(row), 'dim'));
      const cells = profiles.map((profile) => {
        const {text, tone: cellTone} = cell(report, row.route, profile, ink);
        return `${ink.paint(shorten(safe(profile), 14, ink), 'dim')} ${ink.paint(text, cellTone)}`;
      });
      lines.push(`${bar}  ${cells.join(ink.paint(`  ${g.sep} `, 'dim'))}`);
    }
  } else {
    const cellSpan = Math.max(10, Math.min(14, Math.floor((span - 36) / profiles.length)));
    // The request column hugs the longest label it actually has to hold, so a
    // run of short paths does not leave a stripe of empty table between the
    // path and the statuses that belong to it.
    const longest = Math.max(7, ...shown.map((row) =>
      row.method.length + row.label.length + tally(row).length + 1));
    const routeSpan = Math.max(24, Math.min(longest + 2, span - INDENT - cellSpan * profiles.length));
    const header = profiles
      .map((profile) => pad(ink.paint(
        shorten(safe(profile) + (profile === report.config.baseline ? '/base' : ''), cellSpan - 1, ink),
        profile === report.config.baseline ? 'accent' : 'dim',
      ), cellSpan))
      .join('');
    lines.push(`  ${' '.repeat(2)}${pad(ink.paint('request', 'dim'), routeSpan)}${header}`);

    for (const row of shown) {
      const tone = TONES[row.outcome];
      const label = `${safe(row.method)} ${safe(row.label)}`;
      const cells = profiles
        .map((profile) => {
          const {text, tone: cellTone} = cell(report, row.route, profile, ink);
          return pad(ink.paint(text, cellTone), cellSpan);
        })
        .join('');
      const shownLabel = shorten(label, routeSpan - 1 - tally(row).length, ink)
        + ink.paint(tally(row), 'dim');
      lines.push(`  ${rail(ink, tone)} ${pad(shownLabel, routeSpan)}${cells}`);
    }
  }

  if (hidden > 0) {
    lines.push(ink.paint(
      `    ${hidden} more ${hidden === 1 ? 'row is' : 'rows are'} in the saved report`,
      'dim',
    ));
  }
  lines.push('', ...legend(ink, span), '');
  return lines;
}

/**
 * One result: rail, gauge, similarity, finding id, and the request. The two
 * responses that produced it hang off the branch underneath, because a number
 * without the pair of statuses behind it is a claim rather than evidence.
 */
function findingBlock(finding: Finding, ink: Ink, span: number): string[] {
  const g = ink.glyph;
  const tone = CONFIDENCE_TONES[finding.confidence];
  const bar = `  ${rail(ink, tone)} `;
  const match = finding.exact ? 'exact' : `${Math.round(finding.similarity * 100)}%`;
  const head = `${bar}${gauge(finding.similarity, tone, ink)}`
    + `${ink.paint(padStart(match, 6), tone, 'bold')}`
    + `  ${ink.paint(safe(finding.id), 'rule')}  ${safe(finding.method)} `;
  const label = ink.paint(finding.confidence, tone);
  // Measured rather than guessed. A constant here was right at a hundred
  // columns and pushed the row two characters past the edge at sixty, which is
  // the width where an overhang actually costs you a line.
  const room = span - visible(head) - visible(label) - 1;
  const left = head + shorten(safe(finding.path), Math.max(12, room), ink);
  const lines = [left + ' '.repeat(Math.max(1, span - visible(left) - visible(label))) + label];

  // Every session that got through, on one branch each. The old block held one
  // session, so a route open to four of them was four blocks with the same
  // path at the top and the next route pushed off the screen underneath.
  const shown = finding.crossings.slice(0, 4);
  for (const crossing of shown) {
    lines.push(`${bar}${ink.paint(g.tee, 'dim')} ${safe(finding.baseline)} `
      + `${finding.baselineStatus} ${ink.paint(g.arrow, 'dim')} `
      + `${safe(crossing.challenger)} ${crossing.status}`
      + ink.paint(crossing.exact ? '' : `  ${Math.round(crossing.similarity * 100)}%`, 'dim'));
  }
  if (finding.crossings.length > shown.length) {
    lines.push(`${bar}${ink.paint(g.tee, 'dim')} `
      + ink.paint(`and ${finding.crossings.length - shown.length} more`, 'dim'));
  }

  for (const [index, chunk] of wrap(safe(finding.reason), span - INDENT - 6).entries()) {
    const branch = index === 0 ? ink.paint(g.elbow, 'dim') : ' ';
    lines.push(`${bar}${branch} ${ink.paint(chunk, 'dim')}`);
  }

  lines.push('');
  return lines;
}

/**
 * The reward. It has to say what was and was not compared, or it reads as a
 * promise the tool cannot make.
 */
function allClear(report: GatecrashReport, ink: Ink, span: number): string[] {
  const body = `${plural(report.summary.replays, 'request')} across `
    + `${plural(report.config.profiles.length, 'session')}, and nothing that succeeded for `
    + `${safe(report.config.baseline)} came back matching for a session below it. `
    + 'That is all a clean run ever means: these routes, these sessions, this capture.';
  const lines = [`  ${rail(ink, 'blocked')} ${ink.paint('no crossings', 'blocked', 'bold')}`];
  for (const chunk of wrap(body, span - INDENT)) {
    lines.push(`  ${rail(ink, 'blocked')} ${ink.paint(chunk, 'dim')}`);
  }
  lines.push('');
  return lines;
}

/**
 * A proportional bar of the run, then the counts it is made of.
 *
 * Two lines, because there are two things being counted and they do not share
 * a denominator. The old single line read `180 routes · 188 review · 172
 * blocked`, mixing routes, comparisons, and skipped capture entries with
 * nothing to say which was which — and more reviews than routes is a number
 * that makes a reader stop trusting the rest of the page.
 */
function summaryLine(report: GatecrashReport, ink: Ink, width: number, span = 18): string[] {
  const {summary} = report;
  const counts: Array<[string, number, string]> = [
    ['review', summary.reviews, 'review'],
    ['error', summary.errors, 'error'],
    ['changed', summary.changed, 'changed'],
    ['public', summary.publicResults, 'dim'],
    ['blocked', summary.blocked, 'blocked'],
  ];
  const total = Math.max(counts.reduce((sum, [, count]) => sum + count, 0), 1);

  let bar = '';
  let used = 0;
  for (const [, count, tone] of counts) {
    if (count === 0) {
      continue;
    }
    const blocks = Math.min(Math.max(1, Math.round(span * count / total)), span - used);
    bar += ink.paint(ink.glyph.on.repeat(blocks), tone);
    used += blocks;
    if (used >= span) {
      break;
    }
  }
  bar += ink.paint(ink.glyph.off.repeat(span - used), used === 0 ? 'blocked' : 'dim');

  const separator = ink.paint(` ${ink.glyph.sep} `, 'dim');
  const comparisons = [ink.paint(plural(summary.comparisons, 'comparison'), 'dim')];
  for (const [name, count, tone] of counts) {
    if (count > 0) {
      comparisons.push(ink.paint(`${count} ${name}`, tone));
    }
  }

  const routes = [ink.paint(plural(summary.routes, 'route replayed', 'routes replayed'), 'dim')];
  for (const [name, count] of [
    ['high', summary.high],
    ['medium', summary.medium],
    ['low', summary.low],
  ] as const) {
    if (count > 0) {
      routes.push(ink.paint(`${count} ${name}`, CONFIDENCE_TONES[name]));
    }
  }
  if (summary.sampled > 0) {
    routes.push(ink.paint(`${summary.sampled} sampled out`, 'dim'));
  }
  const otherwiseSkipped = summary.skipped - summary.sampled;
  if (otherwiseSkipped > 0) {
    routes.push(ink.paint(`${otherwiseSkipped} skipped`, 'dim'));
  }

  return [
    ...packParts(comparisons, separator, `  ${bar}  `, width),
    ...packParts(routes, separator, `  ${' '.repeat(span)}  `, width),
  ];
}

/**
 * Why the exit code is what it is, naming what caused it. Without this, a run
 * with forty routes and one review gives you a wall of output and a `2`, and
 * no way to tell which line produced it.
 */
function exitLine(report: GatecrashReport, ink: Ink, span: number, failOn?: Confidence): string[] {
  if (failOn === undefined) {
    return [];
  }
  const failing = findingsAtLeast(report, failOn);
  if (failing.length === 0) {
    return [];
  }
  const named = failing.slice(0, 4).map((finding) => safe(finding.id)).join(', ');
  const rest = failing.length > 4 ? `, and ${failing.length - 4} more` : '';
  const lead = `  ${ink.paint('exit 2', 'review', 'bold')}  `;
  const body = `${plural(failing.length, 'route')} at ${failOn} confidence or above: `
    + `${named}${rest}`;
  return wrap(body, Math.max(20, span - visible(lead)))
    .map((chunk, index) => (index === 0 ? lead : ' '.repeat(visible(lead)))
      + ink.paint(chunk, 'dim'));
}

const CONFIDENCE_RANK: Record<Confidence, number> = {high: 0, medium: 1, low: 2};

/** Findings at or above a confidence, which is what a CI gate is asked about. */
export function findingsAtLeast(report: GatecrashReport, floor: Confidence): Finding[] {
  return report.findings.filter((finding) =>
    CONFIDENCE_RANK[finding.confidence] <= CONFIDENCE_RANK[floor]);
}

function footer(result: CheckResult, ink: Ink, span: number): string[] {
  const lines: string[] = [];
  const first = result.report.findings[0];
  if (first !== undefined) {
    const command = `${COMMAND_NAME} explain ${safe(first.id)}`;
    const note = 'to read the evidence behind one';
    // The note is the first thing to go. It says nothing the command does not.
    const room = span - command.length - note.length - 7 >= 0;
    lines.push(`  ${ink.paint(ink.glyph.chevron, 'accent')} ${ink.paint(command, 'accent')}`
      + (room ? `   ${ink.paint(note, 'dim')}` : ''));
  }
  if (result.reportPath !== undefined) {
    lines.push(ink.paint(`  saved to ${shorten(safe(result.reportPath), span - 12, ink)}`, 'dim'));
  }
  return lines;
}

// Past this many result blocks the screen has stopped helping. The rest are in
// the saved report, and the line below says so.
const MAX_FINDING_BLOCKS = 6;

export function renderReport(
  result: CheckResult,
  ink: Ink,
  span: number,
  failOn?: Confidence,
): string {
  const {report} = result;
  const g = ink.glyph;
  const meta = [
    plural(report.summary.routes, 'route'),
    plural(mapProfiles(report).length, 'session'),
    duration(report.run.durationMs),
  ].join(` ${g.sep} `);

  const lines = ['', ruleLine(COMMAND_NAME, safe(report.run.targetOrigin), meta, ink, span), ''];

  if (result.interrupted === true) {
    lines.push(`  ${rail(ink, 'unclear')} ${ink.paint('interrupted', 'unclear', 'bold')}`);
    for (const chunk of wrap(
      'Stopped before the plan finished. Everything below is the part that ran.',
      span - INDENT,
    )) {
      lines.push(`  ${rail(ink, 'unclear')} ${ink.paint(chunk, 'dim')}`);
    }
    lines.push('');
  }

  lines.push(...alarm(report, ink, span));

  const lead = headline(report);
  if (lead !== '') {
    lines.push(...wrap(lead, span - INDENT).map((chunk) => `  ${ink.paint(chunk, 'bold')}`), '');
  }

  lines.push(...accessMap(report, ink, span));

  if (report.findings.length === 0) {
    lines.push(...allClear(report, ink, span));
  } else {
    const shown = report.findings.slice(0, MAX_FINDING_BLOCKS);
    for (const finding of shown) {
      lines.push(...findingBlock(finding, ink, span));
    }
    if (report.findings.length > shown.length) {
      lines.push(ink.paint(
        `    ${report.findings.length - shown.length} more in the saved report`,
        'dim',
      ), '');
    }
  }

  lines.push(...summaryLine(report, ink, span));
  lines.push(...exitLine(report, ink, span, failOn));
  lines.push(...footer(result, ink, span));
  lines.push('');
  return page(lines);
}

export function renderInspection(inspection: InspectionResult, ink: Ink, span: number): string {
  const g = ink.glyph;
  const meta = fitMeta([
    `${plural(inspection.replays, 'request')} planned`,
    plural(inspection.routes.length, 'route'),
    plural(inspection.profiles, 'session'),
  ], ` ${g.sep} `, span - 30);
  const sampled = inspection.skipped.filter(({reason}) => reason === 'sampled').length;

  const lines = [
    '',
    ruleLine(`${COMMAND_NAME} inspect`, safe(inspection.targetOrigin), meta, ink, span),
    '',
    `  ${rail(ink, 'blocked')} ${ink.paint('nothing was sent', 'blocked', 'bold')}`,
  ];
  for (const chunk of wrap(
    'Inspect reads the same capture and the same configuration as check, resolves no secrets, '
    + 'and opens no connections. This is the plan, not the run.',
    span - INDENT,
  )) {
    lines.push(`  ${rail(ink, 'blocked')} ${ink.paint(chunk, 'dim')}`);
  }
  lines.push('');
  const against = `${safe(inspection.baseline)} ${g.arrow} `
    + inspection.challengers.map(safe).join(', ')
    + (inspection.control ? `, and a credential-free ${CONTROL_PROFILE} session` : '');
  for (const [index, chunk] of wrap(against, span - 14).entries()) {
    lines.push(`  ${ink.paint(index === 0 ? 'baseline' : '        ', 'dim')}  `
      + (index === 0 ? chunk : ink.paint(chunk, 'dim')));
  }
  // A label, two spaces, and whatever is left of the line. The value gives,
  // because the label is what makes the block scannable.
  const field = (label: string, value: string): string =>
    `  ${ink.paint(pad(label, 8), 'dim')}  ${shorten(value, Math.max(12, span - 12), ink)}`;
  lines.push(field('methods', inspection.allowedMethods.join(', ')));
  lines.push(field('capture', safe(inspection.input)));
  // The number that decides whether this command runs now or after lunch. It
  // was computable from the two lines above it all along and never shown, so
  // the way to find out a run took a quarter of an hour was to start it.
  lines.push(field(
    'cost',
    `${plural(inspection.replays, 'request')} ${g.sep} about ${formatDuration(inspection.estimatedMs)}`,
  ));
  lines.push('');

  lines.push(ruleLine(
    'in scope',
    '',
    `${plural(inspection.families.length, 'endpoint')} ${g.sep} `
    + plural(inspection.routes.length, 'route'),
    ink,
    span,
  ), '');
  for (const family of inspection.families.slice(0, 12)) {
    const tally = family.matched === 1 ? '' : ` ×${family.matched}`;
    const held = family.matched - family.replayed;
    lines.push(`  ${rail(ink, 'changed')} ${ink.paint(safe(family.method), 'dim')} `
      + shorten(safe(family.pattern), Math.max(20, span - INDENT - 26), ink)
      + ink.paint(tally, 'dim')
      + (held > 0 ? ink.paint(`  ${family.replayed} sampled`, 'unclear') : ''));
  }
  if (inspection.families.length > 12) {
    lines.push(ink.paint(`    ${inspection.families.length - 12} more`, 'dim'));
  }
  if (sampled > 0) {
    lines.push('', ...wrap(
      `${sampled} routes are held back because another member of the same path family is `
      + 'being sent. Set sample.per_pattern: 0 to send every one of them.',
      span - INDENT,
    ).map((chunk) => ink.paint(`  ${chunk}`, 'dim')));
  }

  if (inspection.skipped.length > 0) {
    const counts = new Map<string, number>();
    for (const item of inspection.skipped) {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    }
    const detail = [...counts.entries()].map(([reason, count]) => `${count} ${reason}`).join(`, `);
    lines.push('', ink.paint(`  ${inspection.skipped.length} skipped: ${detail}`, 'dim'));
  }

  // Same rule as the report footer: the note is an aside and goes first, and
  // the capture name gives only after that. A capture called something long
  // used to push this line nine characters past a sixty-column terminal.
  const note = 'to send them';
  const head = `  ${ink.paint(g.chevron, 'accent')} `;
  const command = `${COMMAND_NAME} check `
    + shorten(safe(inspection.input), Math.max(12, span - visible(head) - 16), ink);
  const room = visible(head) + visible(command) + 3 + note.length <= span;
  lines.push(
    '',
    head + ink.paint(command, 'accent') + (room ? `   ${ink.paint(note, 'dim')}` : ''),
    '',
  );
  return page(lines);
}

export function renderFinding(finding: Finding, reportPath: string, ink: Ink, span: number): string {
  const g = ink.glyph;
  const tone = CONFIDENCE_TONES[finding.confidence];
  const match = finding.exact ? 'exact' : `${Math.round(finding.similarity * 100)}%`;
  const reached = listOf(finding.crossings.map((crossing) =>
    `${safe(crossing.challenger)} ${crossing.status}`));
  const lines = [
    '',
    ruleLine(`${COMMAND_NAME} explain`, safe(finding.id), `${finding.confidence} confidence`, ink, span),
    '',
    `  ${rail(ink, tone)} ${gauge(finding.similarity, tone, ink)}`
    + `${ink.paint(padStart(match, 6), tone, 'bold')}  `
    + `${shorten(safe(finding.method), 12, ink)} `
    + shorten(safe(finding.path), Math.max(18, span - 30), ink),
  ];
  for (const [index, chunk] of wrap(
    `${safe(finding.baseline)} ${finding.baselineStatus} ${g.arrow} ${reached}`,
    span - INDENT - 4,
  ).entries()) {
    lines.push(`  ${rail(ink, tone)} `
      + `${index === 0 ? ink.paint(g.tee, 'dim') : ' '} ${chunk}`);
  }

  for (const [index, item] of finding.evidence.entries()) {
    const last = index === finding.evidence.length - 1;
    const branch = last ? g.elbow : g.tee;
    for (const [chunk, line] of wrap(safe(item), span - INDENT - 8).entries()) {
      lines.push(`  ${rail(ink, tone)} `
        + `${chunk === 0 ? ink.paint(branch, 'dim') : ' '} ${ink.paint(line, 'dim')}`);
    }
  }
  lines.push('');

  for (const chunk of wrap(safe(finding.reason), span - INDENT)) {
    lines.push(`  ${chunk}`);
  }
  lines.push('');
  for (const chunk of wrap(
    'Gatecrash compares responses. It does not know what this application intends to allow, so a '
    + 'result is a lead: verify it against the access policy and the raw exchange in your proxy.',
    span - INDENT,
  )) {
    lines.push(`  ${ink.paint(chunk, 'dim')}`);
  }
  lines.push('', ink.paint(`  from ${shorten(safe(reportPath), span - 8, ink)}`, 'dim'), '');
  return page(lines);
}

interface WelcomeOptions {
  depth?: number;
  animate?: boolean;
  stream?: {isTTY?: boolean; columns?: number; write: (chunk: string) => unknown};
  room?: number;
}

export function renderWelcome(ink: Ink, span: number, options: WelcomeOptions = {}): string {
  const g = ink.glyph;
  const lines = [
    logo({
      depth: options.depth ?? ink.depth,
      version: VERSION,
      ...(options.animate === undefined ? {} : {animate: options.animate}),
      ...(options.stream === undefined ? {} : {stream: options.stream}),
      ...(options.room === undefined ? {} : {room: options.room}),
    }).replace(/\n$/, ''),
    '',
  ];
  for (const chunk of wrap(DESCRIPTION, span - INDENT)) {
    lines.push(`  ${chunk}`);
  }
  for (const chunk of wrap('Built for authorized tests, labs, and repeatable access reviews.', span - INDENT)) {
    lines.push(ink.paint(`  ${chunk}`, 'dim'));
  }
  lines.push('');

  const steps: Array<[string, string, string]> = [
    ['try it', `${COMMAND_NAME} demo`, 'a local lab with two real bugs in it'],
    ['set up', `${COMMAND_NAME} init`, 'write a starter configuration'],
    ['preview', `${COMMAND_NAME} inspect capture.har`, 'see the plan without sending anything'],
  ];
  const commandSpan = Math.max(...steps.map(([, command]) => command.length)) + 5;
  for (const [label, command, note] of steps) {
    const head = `  ${ink.paint(pad(label, 9), label === 'try it' ? 'accent' : 'dim')}`
      + pad(command, commandSpan);
    // The note is an aside. It goes before the line does.
    const room = visible(head) + note.length <= span;
    lines.push(room ? head + ink.paint(note, 'dim') : head.replace(/\s+$/, ''));
  }
  lines.push('', ink.paint(`  ${g.chevron} ${COMMAND_NAME} --help`, 'dim'), '');
  return page(lines);
}

export function renderError(error: unknown, ink: Ink, span: number): string {
  const hint = error instanceof GatecrashError ? error.hint : undefined;
  const lines = ['', ruleLine(`${COMMAND_NAME} error`, '', '', ink, span), ''];
  for (const chunk of wrap(safe(errorMessage(error)), span - INDENT)) {
    lines.push(`  ${rail(ink, 'error')} ${chunk}`);
  }
  if (hint !== undefined) {
    lines.push(`  ${rail(ink, 'error')}`);
    for (const [index, chunk] of wrap(safe(hint), span - INDENT - 6).entries()) {
      lines.push(`  ${rail(ink, 'error')} ${index === 0 ? ink.paint('fix', 'accent') : '   '}  ${ink.paint(chunk, 'dim')}`);
    }
  }
  lines.push('');
  return page(lines);
}

export {TAGLINE};
