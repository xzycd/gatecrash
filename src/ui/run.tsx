import {render} from 'ink';
import type {CheckResult, RunProgress} from '../core/types.js';
import {CheckApp, ExplainView} from './components.js';
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
  const instance = render(<CheckApp execute={execute} onSettled={settle} />);
  const result = await settled;
  await instance.waitUntilExit();
  return result;
}

export function showFindingInterface(finding: Finding, reportPath: string): void {
  const instance = render(<ExplainView finding={finding} reportPath={reportPath} />);
  instance.unmount();
}
