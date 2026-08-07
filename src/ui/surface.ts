/**
 * Where the views meet the process.
 *
 * One decision is made here and nowhere else: what this particular stream can
 * take. Everything downstream is handed an `Ink` and never asks again, which
 * is what makes `--plain`, a pipe, `NO_COLOR=1`, and a terminal that cannot
 * draw a box the same code path with different escapes.
 */
import type {
  CheckResult,
  Confidence,
  Finding,
  InspectionResult,
  RunProgress,
} from '../core/types.js';
import {wantsAnimation} from '../brand.js';
import {colorDepth, glyphs, Ink, wantsLinks, width} from './ink.js';
import {Ticker} from './motion.js';
import {
  renderError,
  renderFinding,
  renderInspection,
  renderReport,
  renderWelcome,
} from './view.js';

interface Surface {
  isTTY?: boolean;
  columns?: number;
  write: (chunk: string) => unknown;
}

export function inkFor(stream: Surface, plain = false): Ink {
  if (plain) {
    return new Ink(0, false, glyphs());
  }
  return new Ink(colorDepth('auto', stream), wantsLinks(stream), glyphs());
}

export function writeWelcome(stream: Surface = process.stdout, plain = false): void {
  const ink = inkFor(stream, plain);
  stream.write(renderWelcome(ink, width(stream), {
    depth: ink.depth,
    animate: !plain && wantsAnimation(ink.depth, stream),
    stream,
  }));
}

export function writeReport(
  result: CheckResult,
  options: {stream?: Surface; plain?: boolean; failOn?: Confidence} = {},
): void {
  const stream = options.stream ?? process.stdout;
  stream.write(renderReport(
    result,
    inkFor(stream, options.plain ?? false),
    width(stream),
    options.failOn,
  ));
}

export function writeInspection(
  inspection: InspectionResult,
  options: {stream?: Surface; plain?: boolean} = {},
): void {
  const stream = options.stream ?? process.stdout;
  stream.write(renderInspection(inspection, inkFor(stream, options.plain ?? false), width(stream)));
}

export function writeFinding(
  finding: Finding,
  reportPath: string,
  options: {stream?: Surface; plain?: boolean} = {},
): void {
  const stream = options.stream ?? process.stdout;
  stream.write(renderFinding(
    finding,
    reportPath,
    inkFor(stream, options.plain ?? false),
    width(stream),
  ));
}

export function writeError(error: unknown, stream: Surface = process.stderr): void {
  stream.write(renderError(error, inkFor(stream), width(stream)));
}

/**
 * Run the check with a live line on stderr.
 *
 * The line is stopped before anything is written to stdout, so a report never
 * lands on top of a half-erased frame, and it is stopped on the failure path
 * too: an error view printed underneath a spinner still ticking is how a run
 * that stopped cleanly looks like one that hung.
 */
export async function runWithProgress(
  execute: (onProgress: (progress: RunProgress) => void) => Promise<CheckResult>,
  options: {stream?: Surface; plain?: boolean} = {},
): Promise<CheckResult> {
  const stream = options.stream ?? process.stderr;
  if (options.plain === true || stream.isTTY !== true) {
    return execute(() => undefined);
  }

  const ticker = new Ticker(inkFor(stream), stream);
  ticker.start();
  try {
    return await execute(ticker.update);
  } finally {
    ticker.stop();
  }
}
