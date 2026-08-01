/**
 * The name, the line, and the mark.
 *
 * A five row block alphabet that knows eight letters, which is exactly enough
 * to spell one word. Carrying a general figlet font to render a fixed string
 * would be more code and less ours.
 *
 * The animation is a left to right reveal, about a fifth of a second, and it
 * only runs where it can do no harm: an interactive terminal, colour enabled,
 * not under CI, and never in front of machine-readable output. Anything that
 * delays a pipe or corrupts a redirect has stopped being decoration and
 * started being a bug.
 */
import {code, columns as terminalColumns, RAMP, RESET} from './ui/ink.js';

export const COMMAND_NAME = 'gatecrash';
export const TAGLINE = 'Same request. Wrong session.';
export const DESCRIPTION =
  'Replay captured web requests across sessions and map authorization boundaries.';
export const COMPACT_MARK = '◆╾┫';

const GLYPHS: Record<string, string[]> = {
  g: ['████', '█   ', '█ ██', '█  █', '████'],
  a: ['███', '█ █', '███', '█ █', '█ █'],
  t: ['███', ' █ ', ' █ ', ' █ ', ' █ '],
  e: ['███', '█  ', '██ ', '█  ', '███'],
  c: ['███', '█  ', '█  ', '█  ', '███'],
  r: ['██ ', '█ █', '██ ', '█ █', '█ █'],
  s: ['███', '█  ', '███', '  █', '███'],
  h: ['█ █', '█ █', '███', '█ █', '█ █'],
};

const SWEEP: readonly [string, number] = ['#FFFFFF', 231];
const TAIL: readonly [string, number] = ['#7C7C8A', 243];

// A request diamond crossing a split gate. It arrives after the wordmark has
// finished drawing rather than with it, so there is a beat and then the mark.
// Blocks and spaces only: every other character doubles into two of itself
// when the mark is drawn at scale.
const GATE = [
  '██     ██',
  '██  █  ██',
  '██ ███ ██',
  '██  █  ██',
  '██     ██',
];
const GATE_GAP = 4;

// The mark steps down rather than wrapping. Block letters that run past the
// edge do not degrade, they shred: the second half of every row lands under
// the first and the whole thing reads as noise. These are the widths each size
// actually needs, measured from the glyph table rather than guessed.
//
//   scale 2 = 72 columns of letters, + 4 gap + 18 of gate = 94, + 2 indent
//   scale 2 alone                                         = 72, + 2 indent
//   scale 1 alone                                         = 36, + 2 indent
const GATE_MIN_WIDTH = 98;
const WORDMARK_MIN_WIDTH = 76;
const SMALL_MIN_WIDTH = 40;

// Two columns a frame at 6ms puts the whole reveal near 200ms. Slower than
// that and it stops feeling like the program starting and starts feeling like
// the program hanging.
const FRAME_MS = 6;
const COLUMNS_PER_FRAME = 2;
const GATE_BEAT_MS = 70;

interface WriteStream {
  isTTY?: boolean;
  columns?: number;
  write: (chunk: string) => unknown;
}

/**
 * Terminal cells are about twice as tall as they are wide, so a glyph drawn
 * one cell per pixel comes out spindly. Doubling horizontally is what makes it
 * read as a logo rather than as ASCII art.
 */
export function render(word = COMMAND_NAME, scale = 2): string[] {
  const rows = ['', '', '', '', ''];
  for (const [index, letter] of [...word].entries()) {
    const glyph = GLYPHS[letter];
    if (glyph === undefined) {
      continue;
    }
    const gap = index === 0 ? '' : ' '.repeat(scale);
    for (let row = 0; row < rows.length; row += 1) {
      const source = glyph[row] ?? '';
      rows[row] += gap + [...source].map((character) => character.repeat(scale)).join('');
    }
  }
  return rows;
}

/**
 * How big the mark can be drawn here: `[scale, gate]`.
 *
 * A scale of 0 means there is no room for block letters at all and the caller
 * falls back to a plain line. Four sizes beats one size that wraps: a terminal
 * at forty columns is a real place people work.
 */
export function fit(room: number = terminalColumns()): [number, boolean] {
  if (room >= GATE_MIN_WIDTH) {
    return [2, true];
  }
  if (room >= WORDMARK_MIN_WIDTH) {
    return [2, false];
  }
  if (room >= SMALL_MIN_WIDTH) {
    return [1, false];
  }
  return [0, false];
}

/** The wordmark, with the gate beside it when there is room for it. */
export function mark(scale = 2, gate = true): string[] {
  const rows = render(COMMAND_NAME, scale);
  if (!gate) {
    return rows;
  }
  const posts = GATE.map((row) => [...row].map((character) => character.repeat(scale)).join(''));
  return rows.map((row, index) => `${row}${' '.repeat(GATE_GAP)}${posts[index] ?? ''}`);
}

function paint(rows: string[], depth: number, upTo?: number, highlight?: number): string[] {
  return rows.map((row, index) => {
    const entry = RAMP[index];
    if (entry === undefined) {
      return row;
    }
    const tint = code(entry, depth);
    const sweep = code(SWEEP, depth);
    const shown = upTo === undefined ? row : row.slice(0, upTo);
    if (highlight !== undefined && highlight >= 0 && highlight < shown.length) {
      const head = shown.slice(0, highlight);
      const tail = shown.slice(highlight + 1);
      return `${tint}${head}${sweep}${shown[highlight]}${tint}${tail}${RESET}`;
    }
    return `${tint}${shown}${RESET}`;
  });
}

/** One frame with everything past `at` lit, so the gate lands instead of fading in. */
function arrival(rows: string[], depth: number, at: number): string[] {
  return rows.map((row, index) => {
    const entry = RAMP[index];
    if (entry === undefined) {
      return row;
    }
    return `${code(entry, depth)}${row.slice(0, at)}${code(SWEEP, depth)}${row.slice(at)}${RESET}`;
  });
}

export function wantsAnimation(
  depth: number,
  stream: WriteStream,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return depth > 0
    && stream.isTTY === true
    && environment.CI === undefined
    && environment.GATECRASH_NO_ANIMATION === undefined;
}

interface LogoOptions {
  depth?: number;
  animate?: boolean;
  version?: string;
  stream?: WriteStream;
  room?: number;
}

/** The full mark. Animates in place when asked, then returns the final frame. */
export function logo(options: LogoOptions = {}): string {
  const depth = options.depth ?? 0;
  const stream = options.stream ?? process.stdout;
  const room = options.room ?? terminalColumns(stream);
  const version = options.version ?? '';
  const [scale, gate] = fit(room);

  if (scale === 0) {
    // Narrower than the smallest letters. A wrapped wordmark is worse than
    // none, and the name still has to appear somewhere. The version goes too
    // if even that does not fit.
    let name = version === '' ? COMMAND_NAME : `${COMMAND_NAME} v${version}`;
    if (name.length + 2 > room) {
      name = COMMAND_NAME;
    }
    const entry = RAMP[2];
    const painted = depth > 0 && entry !== undefined ? `${code(entry, depth)}${name}${RESET}` : name;
    return `\n  ${painted}\n`;
  }

  const word = render(COMMAND_NAME, scale);
  const span = Math.max(...word.map((row) => row.length));
  const rows = mark(scale, gate);

  if (options.animate === true) {
    stream.write('\n');
    for (let step = 0; step <= span + COLUMNS_PER_FRAME; step += COLUMNS_PER_FRAME) {
      if (step > 0) {
        stream.write(`\u001B[${word.length}A`);
      }
      const frame = paint(word, depth, step, step - 1);
      stream.write(frame.map((line) => `\r\u001B[K  ${line}\n`).join(''));
      sleep(FRAME_MS);
    }
    if (gate) {
      stream.write(`\u001B[${word.length}A`);
      stream.write(arrival(rows, depth, span).map((line) => `\r\u001B[K  ${line}\n`).join(''));
      sleep(GATE_BEAT_MS);
    }
    // One more than the mark is tall. The animation opened with a blank line
    // and the string returned below opens with one too, so landing on the mark
    // itself would print every row one line low and leave the first frame
    // showing above it.
    stream.write(`\u001B[${word.length + 1}A`);
  }

  const body = depth > 0 ? paint(rows, depth) : rows;
  const lines = ['', ...body.map((line) => `  ${line}`)];

  // The tagline is the first thing to go. It is the one part of the mark that
  // says nothing you cannot read in the help text underneath it.
  let tail = version === '' ? TAGLINE : `${TAGLINE}   v${version}`;
  if (tail.length + 2 > room) {
    tail = version === '' ? '' : `v${version}`;
  }
  if (tail !== '') {
    lines.push(depth > 0 ? `  ${code(TAIL, depth)}${tail}${RESET}` : `  ${tail}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The reveal has to block, because the next frame overwrites the last one and
 * a promise would let the caller print underneath a half-drawn mark. It runs
 * only on an interactive terminal, for about a fifth of a second, and never in
 * front of machine-readable output.
 */
function sleep(milliseconds: number): void {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds);
}
