export function terminalText(value: string): string {
  let safe = '';
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    const terminalControl = point <= 31 || point >= 127 && point <= 159;
    const bidiControl =
      point >= 0x202A && point <= 0x202E ||
      point >= 0x2066 && point <= 0x2069;
    if (!terminalControl && !bidiControl) {
      safe += character;
    }
  }
  return safe;
}

export function containsRequestControl(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 31 || point >= 127 && point <= 159) {
      return true;
    }
  }
  return false;
}
