/**
 * The line that moves while a run is happening.
 *
 * A run spends most of its time waiting on a target that is not going to
 * redraw anything on its own, so the display runs on a timer and the work loop
 * only leaves state behind for it to read. Redrawing from inside the work loop
 * meant a run blocked for ten seconds on a slow route sat with a frozen line,
 * looking exactly like a run that had died.
 *
 * What moves stays honest about what it means. The bar is real progress
 * through a real list of replays and never advances on its own. The spinner is
 * time passing and claims nothing about how far along anything is.
 *
 * It draws on stderr. The report goes to stdout, so `--format json` stays a
 * clean pipe even while the line is moving.
 */
import type {RunProgress, RunStage} from '../core/types.js';
import {terminalText} from '../utils/security.js';
import {duration, pulse, spinnerFrame, visible, type Ink} from './ink.js';

const STAGES: Record<RunStage, string> = {
  capture: 'reading',
  scope: 'scoping',
  replay: 'replaying',
  compare: 'comparing',
  report: 'writing',
};

// Nothing is drawn for the first fraction of a second, so a run that finishes
// in three milliseconds does not flash a progress bar on its way past.
const QUIET_MS = 150;
// Twelve or so frames a second is smooth enough for a spinner and gentle
// enough not to flood a terminal on the far end of an ssh session.
const TICK_MS = 80;
const STAGE_COLUMN = 12;
const BAR_SPAN = 14;

interface ProgressStream {
  isTTY?: boolean;
  columns?: number;
  write: (chunk: string) => unknown;
}

/** One rendered line. Pure, so a test can read it without a terminal. */
export function frame(
  progress: RunProgress,
  elapsedMs: number,
  ink: Ink,
  step: number,
  span = 100,
): string {
  const g = ink.glyph;
  const done = progress.completed;
  const total = progress.total;
  const filled = total > 0 ? Math.round(BAR_SPAN * Math.min(1, done / total)) : 0;
  const bar = ink.paint(g.on.repeat(Math.max(0, filled - 1)), 'accent')
    + (filled > 0 ? pulse(g.on, step, ink) : '')
    + ink.paint(g.off.repeat(BAR_SPAN - filled), 'dim');

  const said = STAGES[progress.stage];
  const gap = ' '.repeat(Math.max(1, STAGE_COLUMN - said.length));
  const counts = progress.stage === 'replay' && total > 0 ? `${done}/${total}` : '';
  // Elapsed answers "is it moving". Remaining answers "do I wait", which is
  // the question a run held at two requests a second is actually raising.
  const clock = progress.remainingMs !== undefined && progress.remainingMs >= 2_000
    ? `${duration(elapsedMs)} ${g.sep} ${duration(progress.remainingMs)} left`
    : duration(elapsedMs);
  const trail = [counts, terminalText(progress.detail, 60), clock]
    .filter((part) => part !== '')
    .join(`  ${g.sep}  `);

  const line = `  ${pulse(spinnerFrame(step, ink), step, ink)} `
    + `${pulse(said, step, ink)}${gap}${bar}  ${ink.paint(trail, 'dim')}`;
  // The line is redrawn in place, so anything past the edge wraps and leaves a
  // stripe of dead text behind when it is erased.
  return visible(line) <= span ? line : line.slice(0, line.length - (visible(line) - span));
}

/**
 * Owns the live line: a timer draws it, the work loop reports into it.
 *
 * `update` is called from the hot loop and does nothing but rebind a field.
 * The drawing timer reads whatever is there when it fires, so the work loop
 * never waits on the display and the display never waits on the work.
 */
export class Ticker {
  readonly #ink: Ink;
  readonly #stream: ProgressStream;
  #progress: RunProgress | undefined;
  #timer: NodeJS.Timeout | undefined;
  #started = 0;
  #step = 0;
  #drew = false;

  constructor(ink: Ink, stream: ProgressStream = process.stderr) {
    this.#ink = ink;
    this.#stream = stream;
  }

  update = (progress: RunProgress): void => {
    this.#progress = progress;
  };

  start(): void {
    if (this.#stream.isTTY !== true) {
      return;
    }
    this.#started = performance.now();
    this.#timer = setInterval(() => this.#draw(), TICK_MS);
    // A run should not be held open by its own progress line.
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    // Only erase a line that was written, or a fast run leaves a stray escape
    // sequence on stderr for nothing.
    if (this.#drew) {
      this.#stream.write('\r\u001B[K');
      this.#drew = false;
    }
  }

  #draw(): void {
    const elapsed = performance.now() - this.#started;
    if (elapsed < QUIET_MS || this.#progress === undefined) {
      return;
    }
    this.#step += 1;
    const span = Math.max(40, (this.#stream.columns ?? 100) - 1);
    try {
      this.#stream.write(`\r\u001B[K${frame(this.#progress, elapsed, this.#ink, this.#step, span)}`);
      this.#drew = true;
    } catch {
      // The stream went away underneath us, which happens while a process is
      // being torn down. Stop drawing rather than throw out of a timer nobody
      // is watching.
      this.stop();
    }
  }
}
