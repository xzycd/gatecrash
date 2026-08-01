/**
 * Terminal primitives: colour, glyphs, gauges, rails, panels, links.
 *
 * Everything here is about how a line looks. `view.ts` decides what goes on
 * it. Keeping the two apart is what stops a change to the palette turning into
 * a change to the wording.
 *
 * Three things degrade, in this order. Colour drops from 24-bit to the 256
 * palette to nothing at all. Box drawing drops to ASCII when the terminal
 * cannot promise UTF-8. Hyperlinks disappear when nothing is there to click
 * them. Each falls back on its own, so a plain pipe on an old terminal gets
 * readable output rather than a worse version of a nicer one.
 */

export const RESET = '\u001B[0m';
export const BOLD = '\u001B[1m';

export type PaletteEntry = readonly [string, number];

/**
 * (24-bit, xterm-256). Two families and nothing else.
 *
 * Severity is one ramp that cools down as the news gets better: red for a
 * result to review, ember for a request that failed, straw for one that could
 * not be established, grey for a difference that is only a difference, green
 * for a door that held. Lime is the brand, and it never means a severity, so
 * the eye learns that anything lime is the tool talking about itself.
 *
 * Nothing is fully saturated. A report is read for minutes at a time.
 */
export const PALETTE: Record<string, PaletteEntry> = {
  accent: ['#C9FF43', 191],
  review: ['#FF5E5E', 203],
  error: ['#DE8A46', 173],
  unclear: ['#C2A052', 179],
  // `changed` sits close to dim on purpose. A wall of changed routes is
  // background, and the one review behind it is what somebody opened this for.
  changed: ['#7E8798', 103],
  blocked: ['#6FAE82', 108],
  dim: ['#6B6B78', 242],
  rule: ['#9A9AB8', 146],
  paper: ['#FFFFFF', 231],
};

// Dark at the posts, bright at the gap, like the mark. The wordmark reads down
// it and the spinner walks along it.
export const RAMP: PaletteEntry[] = [
  ['#5C6B22', 100],
  ['#8CAF2F', 106],
  ['#C9FF43', 191],
  ['#8CAF2F', 106],
  ['#5C6B22', 100],
];

export const UNICODE = {
  line: '─', tee: '├', pipe: '│', elbow: '└',
  on: '█', off: '░', sep: '·', chevron: '›', arrow: '→',
  rail: '▌', tl: '╭', tr: '╮', bl: '╰', br: '╯', edge: '│',
  ellipsis: '…', lamp: '●', hollow: '○', trace: '·',
} as const;

export const ASCII: Record<keyof typeof UNICODE, string> = {
  line: '-', tee: '+', pipe: '|', elbow: '`',
  on: '#', off: '.', sep: '-', chevron: '>', arrow: '->',
  rail: '|', tl: '+', tr: '+', bl: '+', br: '+', edge: '|',
  ellipsis: '...', lamp: '*', hollow: 'o', trace: '.',
};

export type Glyphs = Record<keyof typeof UNICODE, string>;

// CSI colour codes and OSC sequences both have to come off before any width
// arithmetic, or every padded column drifts by the length of its escapes. The
// control characters are the subject of this pattern rather than a mistake in
// it, which is the one case the rule exists to catch.
// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001B\][^\u001B\u0007]*(?:\u001B\\|\u0007)|\u001B\[[0-9;]*m/g;

export type ColorFlag = 'auto' | 'always' | 'never';

interface OutputStream {
  isTTY?: boolean;
  columns?: number;
}

/** 0 for no colour, 8 for the 256 palette, 24 for direct colour. */
export function colorDepth(
  flag: ColorFlag = 'auto',
  stream: OutputStream = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  if (flag === 'never') {
    return 0;
  }
  if (flag !== 'always' && (environment.NO_COLOR !== undefined || stream.isTTY !== true)) {
    return 0;
  }
  if (['truecolor', '24bit'].includes((environment.COLORTERM ?? '').toLowerCase())) {
    return 24;
  }

  const term = environment.TERM ?? '';
  if (term === 'dumb') {
    return 0;
  }
  // Terminals that only ever ship direct colour do not bother advertising it.
  if (['kitty', 'alacritty', 'ghostty', 'wezterm'].some((name) => term.includes(name))) {
    return 24;
  }
  if (['iTerm.app', 'WezTerm', 'ghostty', 'vscode'].includes(environment.TERM_PROGRAM ?? '')) {
    return 24;
  }
  return 8;
}

/**
 * Hyperlinks are ignored by terminals that do not understand them, but not by
 * files and pipes, where the escape ends up in the text.
 */
export function wantsLinks(
  stream: OutputStream = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return stream.isTTY === true
    && environment.TERM !== 'dumb'
    && environment.GATECRASH_NO_LINKS === undefined;
}

/**
 * Box drawing only when the terminal has said it can take it. Node does not
 * report an encoding for a pipe, so the locale is the only thing left to ask,
 * and a wrong guess here is a report full of replacement characters.
 */
export function glyphs(environment: NodeJS.ProcessEnv = process.env): Glyphs {
  const declared = environment.LC_ALL ?? environment.LC_CTYPE ?? environment.LANG ?? '';
  return declared.toLowerCase().includes('utf') ? UNICODE : ASCII;
}

/**
 * What the terminal actually is. `width` clamps this, because a report laid
 * out in forty columns is unreadable whatever you do to it, so it takes the
 * overflow instead. Anything drawn as a picture needs the real number: the
 * wordmark cannot take the overflow, it just wraps into confetti.
 */
export function columns(stream: OutputStream = process.stdout): number {
  return stream.columns ?? 100;
}

export function width(stream: OutputStream = process.stdout): number {
  return Math.max(60, Math.min(columns(stream), 120));
}

/**
 * Applies colour, or does not. Everything drawn goes through one of these so
 * that a plain run is the same code path with the escapes left out.
 */
export class Ink {
  readonly depth: number;
  readonly on: boolean;
  readonly links: boolean;
  readonly glyph: Glyphs;

  constructor(depth = 0, links = false, glyph: Glyphs = glyphs()) {
    this.depth = depth;
    this.on = depth > 0;
    this.links = links;
    this.glyph = glyph;
  }

  paint(text: string, ...names: string[]): string {
    if (!this.on || names.length === 0) {
      return text;
    }
    const codes = names.map((name) => (name === 'bold' ? BOLD : this.fg(name))).join('');
    return `${codes}${text}${RESET}`;
  }

  fg(name: string): string {
    return this.#code(name, 38);
  }

  bg(name: string): string {
    return this.#code(name, 48);
  }

  #code(name: string, plane: number): string {
    const entry = PALETTE[name];
    return entry === undefined ? '' : code(entry, this.depth, plane);
  }
}

/** One palette entry, rendered at whatever the terminal can take. */
export function code(entry: PaletteEntry, depth: number, plane = 38): string {
  const [hex, x256] = entry;
  if (depth >= 24) {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    return `\u001B[${plane};2;${red};${green};${blue}m`;
  }
  return `\u001B[${plane};5;${x256}m`;
}

export function visible(text: string): number {
  return text.replaceAll(ESCAPES, '').length;
}

/**
 * Reverse-video label. The padding gives the background something to sit on,
 * and is kept without colour so a badge occupies the same width either way.
 * Columns are laid out around it.
 */
export function badge(text: string, ink: Ink, tone = 'review'): string {
  if (!ink.on) {
    return ` ${text} `;
  }
  return `${ink.bg(tone)}${ink.fg('paper')}${BOLD} ${text} ${RESET}`;
}

/**
 * A similarity is a number people argue about. A bar is one they can read
 * across eight routes without doing any arithmetic.
 */
export function gauge(ratio: number, tone: string, ink: Ink, span = 10): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = clamped <= 0 ? 0 : Math.min(span, Math.max(1, Math.round(span * clamped)));
  const head = ink.paint(ink.glyph.on.repeat(filled), tone);
  return filled < span ? head + ink.paint(ink.glyph.off.repeat(span - filled), 'dim') : head;
}

/**
 * The coloured edge down the left of a result. It is what makes a block of
 * evidence read as one route rather than as four loose lines.
 */
export function rail(ink: Ink, tone: string): string {
  return ink.paint(ink.glyph.rail, tone);
}

/**
 * A box. Used exactly once, for the one result that is not a judgement call.
 * If everything is in a box then nothing is.
 */
export function panel(
  title: string,
  body: string[],
  ink: Ink,
  tone: string,
  span: number,
  indent = '  ',
): string[] {
  const g = ink.glyph;
  const inner = span - indent.length - 4;
  let head = `${g.tl}${g.line} ${title} `;
  head += g.line.repeat(Math.max(0, span - indent.length - visible(head) - 1)) + g.tr;

  const lines = [indent + ink.paint(head, tone)];
  for (const line of body) {
    const pad = ' '.repeat(Math.max(0, inner - visible(line)));
    lines.push(`${indent}${ink.paint(g.edge, tone)}  ${line}${pad}${ink.paint(g.edge, tone)}`);
  }
  lines.push(indent + ink.paint(g.bl + g.line.repeat(span - indent.length - 2) + g.br, tone));
  return lines;
}

export function link(text: string, url: string, ink: Ink): string {
  if (!ink.links || url === '') {
    return text;
  }
  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
}

export function duration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)} ms`;
  }
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

const SPINNER_UNICODE = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const SPINNER_ASCII = '|/-\\';

export function spinnerFrame(step: number, ink: Ink): string {
  const frames = ink.glyph === UNICODE ? SPINNER_UNICODE : SPINNER_ASCII;
  return frames[step % frames.length] ?? '';
}

/**
 * Walk the ramp and walk back, so the colour breathes instead of restarting
 * with a jolt every time it runs out of stops.
 */
export function pulse(text: string, step: number, ink: Ink): string {
  if (!ink.on) {
    return text;
  }
  const swing = 2 * RAMP.length - 2;
  const at = step % swing;
  const entry = RAMP[at < RAMP.length ? at : swing - at];
  return entry === undefined ? text : code(entry, ink.depth) + text + RESET;
}

/** Greedy word wrap. Long words are broken rather than allowed to overhang. */
export function wrap(value: string, span: number): string[] {
  if (span < 8) {
    return [value];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/).filter((part) => part !== '')) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= span) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
    while (current.length > span) {
      lines.push(current.slice(0, span));
      current = current.slice(span);
    }
  }
  if (current !== '') {
    lines.push(current);
  }
  return lines.length === 0 ? [''] : lines;
}

/** Shorten from the middle, so both the route and its tail stay readable. */
export function shorten(value: string, span: number, ink: Ink): string {
  if (value.length <= span) {
    return value;
  }
  const mark = ink.glyph.ellipsis;
  if (span <= mark.length) {
    return value.slice(0, Math.max(0, span));
  }
  const left = Math.ceil((span - mark.length) / 2);
  const right = Math.floor((span - mark.length) / 2);
  return `${value.slice(0, left)}${mark}${right === 0 ? '' : value.slice(-right)}`;
}

/** Pad on the right to a visible width, ignoring escape sequences. */
export function pad(text: string, span: number): string {
  return text + ' '.repeat(Math.max(0, span - visible(text)));
}

/** Pad on the left, so a column of numbers lines up on its last digit. */
export function padStart(text: string, span: number): string {
  return ' '.repeat(Math.max(0, span - visible(text))) + text;
}

/**
 * Trailing spaces are invisible on screen and noise in every other place the
 * output ends up.
 */
export function page(lines: string[]): string {
  return `${lines.map((line) => line.replace(/\s+$/, '')).join('\n')}\n`;
}
