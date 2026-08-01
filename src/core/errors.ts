export class GatecrashError extends Error {
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(message: string, options: {hint?: string; exitCode?: number} = {}) {
    super(message);
    this.name = 'GatecrashError';
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
