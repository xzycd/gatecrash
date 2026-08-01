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
import {errorMessage, GatecrashError} from '../core/errors.js';
import type {
  CheckResult,
  ComparisonOutcome,
  Finding,
  GatecrashReport,
  InspectionResult,
  RouteReport,
} from '../core/types.js';
import {plural} from '../utils/format.js';
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
  blocked: 'blocked',
};

const SEVERITY: ComparisonOutcome[] = ['review', 'error', 'inconclusive', 'changed', 'same', 'blocked'];

/**
 * Every mark is distinct without colour, because colour is allowed to support
 * a label here and never to carry it. A reader with `NO_COLOR=1` still has to
 * be able to tell a door that held from one that did not.
 */
const MARKS: Record<string, [string, string]> = {
  baseline: ['●', 'o'],
  review: ['!', '!'],
  blocked: ['✓', '+'],
  same: ['=', '='],
  changed: ['≠', '~'],
  inconclusive: ['?', '?'],
  error: ['×', 'x'],
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
  // The subject is the only part that can give. The label says which command
  // is speaking and the meta says what it did, and a header that drops either
  // to keep an origin whole has kept the wrong thing.
  const room = span - label.length - meta.length - 10;
  const shown = subject === '' ? '' : shorten(subject, Math.max(8, room), ink);
  const head = shown === ''
    ? ink.paint(label, 'accent', 'bold')
    : `${ink.paint(label, 'accent', 'bold')}  ${ink.paint(shown, 'dim')}`;
  const fill = Math.max(2, span - visible(head) - meta.length - 8);
  return `  ${head} ${ink.paint(ink.glyph.line.repeat(fill), 'dim')}  ${ink.paint(meta, 'dim')}`;
}

/**
 * The one case that gets to interrupt: a response that came back byte for byte
 * identical to a session that was not the baseline. A box, used exactly once.
 * If everything is boxed then nothing is.
 */
function alarm(report: GatecrashReport, ink: Ink, span: number): string[] {
  const exact = report.findings.filter((finding) => finding.exact);
  if (exact.length === 0) {
    return [];
  }

  const sessions = [...new Set(exact.map((finding) => finding.challenger))].map(safe);
  const named = sessions.slice(0, 3).join(', ')
    + (sessions.length > 3 ? ` and ${sessions.length - 3} more` : '');
  const body = `${plural(exact.length, 'route')} returned a byte-identical successful response to `
    + `${named}. Check each against the access policy the application is supposed to enforce, `
    + 'then treat what is left as a finding.';

  const wrapped = wrap(body, span - 8).map((line) => ink.paint(line, 'review'));
  return [...panel('EXACT MATCH', wrapped, ink, 'review', span), ''];
}

/** One sentence naming the worst thing in the run, in plain English. */
export function headline(report: GatecrashReport): string {
  const {summary} = report;
  const exact = report.findings.filter((finding) => finding.exact).length;
  if (exact > 0) {
    return exact === 1
      ? '1 session received a response it should have had to earn.'
      : `${exact} sessions received responses they should have had to earn.`;
  }
  if (summary.reviews > 0) {
    return summary.reviews === 1
      ? '1 result is close enough to the baseline to be worth checking.'
      : `${summary.reviews} results are close enough to the baseline to be worth checking.`;
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

function orderedRoutes(report: GatecrashReport): RouteReport[] {
  return [...report.routes].sort((left, right) => {
    const rank = SEVERITY.indexOf(worstOutcome(left)) - SEVERITY.indexOf(worstOutcome(right));
    return rank === 0 ? left.path.localeCompare(right.path) : rank;
  });
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
  const profiles = report.config.profiles.map(({name}) => name);
  const stacked = span < 78 || profiles.length > 4;
  const shown = orderedRoutes(report).slice(0, stacked ? MAP_ROWS_NARROW : MAP_ROWS_WIDE);
  const hidden = report.routes.length - shown.length;
  const g = ink.glyph;

  const lines = [ruleLine(
    'access map',
    '',
    `${plural(report.summary.routes, 'route')} ${g.sep} ${plural(profiles.length, 'session')}`,
    ink,
    span,
  ), ''];

  if (stacked) {
    for (const route of shown) {
      const tone = TONES[worstOutcome(route)];
      const bar = `  ${rail(ink, tone)} `;
      lines.push(`${bar}${ink.paint(safe(route.method), 'dim')} `
        + shorten(safe(route.path), Math.max(20, span - INDENT - 6), ink));
      const cells = profiles.map((profile) => {
        const {text, tone: cellTone} = cell(report, route, profile, ink);
        return `${ink.paint(shorten(safe(profile), 14, ink), 'dim')} ${ink.paint(text, cellTone)}`;
      });
      lines.push(`${bar}  ${cells.join(ink.paint(`  ${g.sep} `, 'dim'))}`);
    }
  } else {
    const cellSpan = Math.max(10, Math.min(14, Math.floor((span - 36) / profiles.length)));
    // The request column hugs the longest route it actually has to hold, so a
    // run of short paths does not leave a stripe of empty table between the
    // path and the statuses that belong to it.
    const longest = Math.max(7, ...shown.map((route) => route.method.length + route.path.length + 1));
    const routeSpan = Math.max(24, Math.min(longest + 2, span - INDENT - cellSpan * profiles.length));
    const header = profiles
      .map((profile) => pad(ink.paint(
        shorten(safe(profile) + (profile === report.config.baseline ? '/base' : ''), cellSpan - 1, ink),
        profile === report.config.baseline ? 'accent' : 'dim',
      ), cellSpan))
      .join('');
    lines.push(`  ${' '.repeat(2)}${pad(ink.paint('request', 'dim'), routeSpan)}${header}`);

    for (const route of shown) {
      const tone = TONES[worstOutcome(route)];
      const label = `${safe(route.method)} ${safe(route.path)}`;
      const cells = profiles
        .map((profile) => {
          const {text, tone: cellTone} = cell(report, route, profile, ink);
          return pad(ink.paint(text, cellTone), cellSpan);
        })
        .join('');
      lines.push(`  ${rail(ink, tone)} ${pad(shorten(label, routeSpan - 1, ink), routeSpan)}${cells}`);
    }
  }

  if (hidden > 0) {
    lines.push(ink.paint(`    ${hidden} more ${hidden === 1 ? 'route is' : 'routes are'} in the saved report`, 'dim'));
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
  const bar = `  ${rail(ink, 'review')} `;
  const match = finding.exact ? 'exact' : `${Math.round(finding.similarity * 100)}%`;
  const head = `${bar}${gauge(finding.similarity, 'review', ink)}`
    + `${ink.paint(padStart(match, 6), 'review', 'bold')}`
    + `  ${ink.paint(safe(finding.id), 'rule')}  ${safe(finding.method)} `;
  const label = ink.paint(finding.confidence === 'high' ? 'review' : 'review, weaker', 'review');
  // Measured rather than guessed. A constant here was right at a hundred
  // columns and pushed the row two characters past the edge at sixty, which is
  // the width where an overhang actually costs you a line.
  const room = span - visible(head) - visible(label) - 1;
  const left = head + shorten(safe(finding.path), Math.max(12, room), ink);
  const lines = [left + ' '.repeat(Math.max(1, span - visible(left) - visible(label))) + label];

  const crossing = `${safe(finding.baseline)} ${finding.baselineStatus} ${g.arrow} `
    + `${safe(finding.challenger)} ${finding.challengerStatus}`;
  lines.push(`${bar}${ink.paint(g.tee, 'dim')} ${crossing}`);
  for (const chunk of wrap(safe(finding.reason), span - INDENT - 10)) {
    lines.push(`${bar}${ink.paint(g.pipe, 'dim')}   ${ink.paint(chunk, 'dim')}`);
  }
  lines.push(`${bar}${ink.paint(g.elbow, 'dim')} ${ink.paint(
    finding.exact
      ? 'the normalized response bodies are identical'
      : `the normalized response bodies match by ${Math.round(finding.similarity * 100)}%`,
    'dim',
  )}`);

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

/** A proportional bar of the run, then the counts it is made of. */
function summaryLine(report: GatecrashReport, ink: Ink, span = 18): string[] {
  const {summary} = report;
  const counts: Array<[string, number, string]> = [
    ['review', summary.reviews, 'review'],
    ['error', summary.errors, 'error'],
    ['changed', summary.changed, 'changed'],
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

  const parts = [ink.paint(plural(summary.routes, 'route'), 'dim')];
  for (const [name, count, tone] of counts) {
    if (count > 0) {
      parts.push(ink.paint(`${count} ${name}`, tone));
    }
  }
  if (summary.skipped > 0) {
    parts.push(ink.paint(`${summary.skipped} skipped`, 'dim'));
  }
  return [`  ${bar}  ${parts.join(ink.paint(` ${ink.glyph.sep} `, 'dim'))}`];
}

/**
 * Why the exit code is what it is, naming what caused it. Without this, a run
 * with forty routes and one review gives you a wall of output and a `2`, and
 * no way to tell which line produced it.
 */
function exitLine(report: GatecrashReport, ink: Ink, failOnReview: boolean): string[] {
  if (!failOnReview || report.summary.reviews === 0) {
    return [];
  }
  const named = report.findings.slice(0, 4).map((finding) => safe(finding.id)).join(', ');
  const rest = report.findings.length > 4 ? `, and ${report.findings.length - 4} more` : '';
  return [`  ${ink.paint('exit 2', 'review', 'bold')}  `
    + ink.paint(`${plural(report.summary.reviews, 'result')} to review: ${named}${rest}`, 'dim')];
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

export function renderReport(result: CheckResult, ink: Ink, span: number, failOnReview = false): string {
  const {report} = result;
  const g = ink.glyph;
  const meta = [
    plural(report.summary.routes, 'route'),
    plural(report.config.profiles.length, 'session'),
    duration(report.run.durationMs),
  ].join(` ${g.sep} `);

  const lines = ['', ruleLine(COMMAND_NAME, safe(report.run.targetOrigin), meta, ink, span), ''];
  lines.push(...alarm(report, ink, span));

  const lead = headline(report);
  if (lead !== '') {
    lines.push(`  ${ink.paint(lead, 'bold')}`, '');
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

  lines.push(...summaryLine(report, ink));
  lines.push(...exitLine(report, ink, failOnReview));
  lines.push(...footer(result, ink, span));
  lines.push('');
  return page(lines);
}

export function renderInspection(inspection: InspectionResult, ink: Ink, span: number): string {
  const g = ink.glyph;
  const meta = [
    plural(inspection.routes.length, 'route'),
    plural(inspection.profiles, 'session'),
    `${plural(inspection.replays, 'request')} planned`,
  ].join(` ${g.sep} `);

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
  lines.push(`  ${ink.paint('baseline', 'dim')}  ${safe(inspection.baseline)} `
    + `${ink.paint(g.arrow, 'dim')} ${inspection.challengers.map(safe).join(', ')}`);
  lines.push(`  ${ink.paint('methods ', 'dim')}  ${inspection.allowedMethods.join(', ')}`);
  lines.push(`  ${ink.paint('capture ', 'dim')}  ${safe(inspection.input)}`);
  lines.push('');

  lines.push(ruleLine('in scope', '', plural(inspection.routes.length, 'route'), ink, span), '');
  for (const route of inspection.routes.slice(0, 12)) {
    lines.push(`  ${rail(ink, 'changed')} ${ink.paint(safe(route.method), 'dim')} `
      + shorten(safe(route.path), Math.max(20, span - INDENT - 8), ink));
  }
  if (inspection.routes.length > 12) {
    lines.push(ink.paint(`    ${inspection.routes.length - 12} more`, 'dim'));
  }

  if (inspection.skipped.length > 0) {
    const counts = new Map<string, number>();
    for (const item of inspection.skipped) {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    }
    const detail = [...counts.entries()].map(([reason, count]) => `${count} ${reason}`).join(`, `);
    lines.push('', ink.paint(`  ${inspection.skipped.length} skipped: ${detail}`, 'dim'));
  }

  lines.push(
    '',
    `  ${ink.paint(g.chevron, 'accent')} `
    + `${ink.paint(`${COMMAND_NAME} check ${safe(inspection.input)}`, 'accent')}`
    + `   ${ink.paint('to send them', 'dim')}`,
    '',
  );
  return page(lines);
}

export function renderFinding(finding: Finding, reportPath: string, ink: Ink, span: number): string {
  const g = ink.glyph;
  const match = finding.exact ? 'exact' : `${Math.round(finding.similarity * 100)}%`;
  const lines = [
    '',
    ruleLine(`${COMMAND_NAME} explain`, safe(finding.id), `${finding.confidence} confidence`, ink, span),
    '',
    `  ${rail(ink, 'review')} ${gauge(finding.similarity, 'review', ink)}`
    + `${ink.paint(padStart(match, 6), 'review', 'bold')}  ${safe(finding.method)} `
    + shorten(safe(finding.path), Math.max(18, span - 30), ink),
    `  ${rail(ink, 'review')} ${ink.paint(g.tee, 'dim')} ${safe(finding.baseline)} `
    + `${finding.baselineStatus} ${ink.paint(g.arrow, 'dim')} ${safe(finding.challenger)} `
    + `${finding.challengerStatus}`,
  ];

  for (const [index, item] of finding.evidence.entries()) {
    const last = index === finding.evidence.length - 1;
    const branch = last ? g.elbow : g.tee;
    for (const [chunk, line] of wrap(safe(item), span - INDENT - 8).entries()) {
      lines.push(`  ${rail(ink, 'review')} `
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
  lines.push('', ink.paint(`  from ${safe(reportPath)}`, 'dim'), '');
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
