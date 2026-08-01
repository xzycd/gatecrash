import {render} from 'ink';
import type {CheckResult, InspectionResult, RunProgress} from '../core/types.js';
import {
  CheckApp,
  ErrorView,
  ExplainView,
  InspectView,
  ReportView,
  WelcomeView,
} from './components.js';
import type {Finding} from '../core/types.js';

interface Settlement {
  result?: CheckResult;
  error?: unknown;
}

export async function runCheckInterface(
  execute: (onProgress: (progress: RunProgress) => void) => Promise<CheckResult>,
): Promise<Settlement> {
  let settle: (value: Settlement) => void = () => undefined;
  const settled = new Promise<Settlement>((resolve) => {
    settle = resolve;
  });
  const instance = render(
    <CheckApp execute={execute} onSettled={settle} />,
    {incrementalRendering: true, maxFps: 20},
  );
  const result = await settled;
  await instance.waitUntilExit();
  instance.cleanup();
  if (result.result !== undefined) {
    const report = render(<ReportView result={result.result} />, {interactive: false});
    report.unmount();
  } else if (result.error !== undefined) {
    const failure = render(<ErrorView error={result.error} />, {interactive: false});
    failure.unmount();
  }
  return result;
}

export function showFindingInterface(finding: Finding, reportPath: string): void {
  const instance = render(<ExplainView finding={finding} reportPath={reportPath} />, {interactive: false});
  instance.unmount();
}

export function showInspectionInterface(inspection: InspectionResult): void {
  const instance = render(<InspectView inspection={inspection} />, {interactive: false});
  instance.unmount();
}

export function showWelcomeInterface(): void {
  const instance = render(<WelcomeView />, {interactive: false});
  instance.unmount();
}

export function showErrorInterface(error: unknown): void {
  const instance = render(<ErrorView error={error} />, {stdout: process.stderr, interactive: false});
  instance.unmount();
}
