export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`;
  }

  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
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
