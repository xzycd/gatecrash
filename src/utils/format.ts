export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`;
  }

  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

export function truncateMiddle(value: string, width: number): string {
  if (value.length <= width || width < 8) {
    return value.slice(0, Math.max(0, width));
  }

  const left = Math.ceil((width - 1) / 2);
  const right = Math.floor((width - 1) / 2);
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}
