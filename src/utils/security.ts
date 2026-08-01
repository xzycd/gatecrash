// Two different jobs live here, and they must not be confused.
//
// `terminalText` is about a screen. Everything Gatecrash prints has passed
// through a capture file or a hostile server at some point, so nothing reaches
// a terminal until the characters that can move a cursor, repaint a line, or
// reorder what a reader sees have been taken out of it.
//
// `containsRequestControl` is about a socket. It rejects the characters that
// let a header value end a header and start something else.

const MAXIMUM_DISPLAY_LENGTH = 2_048;

function isTerminalControl(point: number): boolean {
  // C0 and DEL, then C1. C1 matters because a terminal reading UTF-8 still
  // honours several of them, and 0x9B is a second way to spell CSI.
  return point <= 31 || point >= 127 && point <= 159;
}

function isDeceptive(point: number): boolean {
  return (
    // Soft hyphen: renders as nothing, splits a word that looked whole.
    point === 0x00AD ||
    // Arabic letter mark, and the bidi embeddings, overrides, and isolates.
    // These are the Trojan Source characters: they reorder the glyphs on the
    // line without changing the bytes, so `/api/admin` can be made to read as
    // something harmless.
    point === 0x061C ||
    point >= 0x200B && point <= 0x200F ||
    point >= 0x202A && point <= 0x202E ||
    // Line and paragraph separators. Some terminals break a line on these,
    // which is enough to push a route out of the block it belongs to.
    point === 0x2028 || point === 0x2029 ||
    point >= 0x2066 && point <= 0x2069 ||
    // Word joiner and the invisible operators.
    point >= 0x2060 && point <= 0x2064 ||
    // Zero-width no-break space, still widely emitted as a BOM.
    point === 0xFEFF ||
    // Unpaired surrogates. A well-formed string never contains one; a string
    // that came off a network does.
    point >= 0xD800 && point <= 0xDFFF
  );
}

/**
 * The only way untrusted text is allowed to reach a terminal.
 *
 * Zero-width joiners go too. They carry meaning in several scripts and in
 * emoji sequences, so this is a real cost, but a path is read here to decide
 * whether a session crossed a boundary it should not have. It has to be
 * unambiguous before it is pretty.
 */
export function terminalText(value: string, limit = MAXIMUM_DISPLAY_LENGTH): string {
  let safe = '';
  for (const character of value) {
    if (safe.length >= limit) {
      return `${safe}…`;
    }
    const point = character.codePointAt(0) ?? 0;
    if (!isTerminalControl(point) && !isDeceptive(point)) {
      safe += character;
    }
  }
  return safe;
}

/**
 * True when a value cannot be put on the wire as a header or cookie without
 * risking a second request being smuggled behind it.
 */
export function containsRequestControl(value: string): boolean {
  for (const character of value) {
    if (isTerminalControl(character.codePointAt(0) ?? 0)) {
      return true;
    }
  }
  return false;
}
