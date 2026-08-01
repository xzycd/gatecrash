---
name: Gatecrash
description: Same request. Wrong session.
colors:
  venue-black: "#0B0D0C"
  live-lamp: "#C9FF43"
  live-muted: "#83A92F"
  review-coral: "#FF665E"
  warning-amber: "#F4C95D"
  success-mint: "#6EE7A8"
  changed-blue: "#78A8FF"
  warm-white: "#F4F1E9"
  steel-text: "#9CA2AB"
  steel-faint: "#5C636D"
  rail: "#343A43"
  track: "#20252A"
spacing:
  cell: "1ch"
  channel: "2ch"
  section: "1lh"
components:
  brand-mark:
    textColor: "{colors.live-lamp}"
  channel-label:
    textColor: "{colors.steel-faint}"
  status-live:
    textColor: "{colors.live-lamp}"
  status-review:
    textColor: "{colors.review-coral}"
  status-changed:
    textColor: "{colors.changed-blue}"
  next-action:
    textColor: "{colors.live-lamp}"
---

# Design System: Gatecrash

## Overview

**Creative North Star: "The Midnight Patch Bay"**

Gatecrash borrows from the working side of a small music venue: labeled
channels, physical routing, admission marks, and one lamp that tells the
operator where attention is needed. It feels young because it belongs to a live
room, not because it uses slang or decoration. Every flourish must also explain
a boundary, a session, or a result.

The broken-gate mark is a request crossing a split vertical boundary. During a
run, response tracks behave like patch-bay channels: stable columns, short
labels, clear lamps, and a direct trace from baseline to challenger.

**Key Characteristics:**

- A broken-gate mark paired with a lower-case wordmark.
- Flat, high-contrast color with one electric admission accent.
- Fine channel rails and compact status lamps instead of generic cards.
- Strong hierarchy on first run, followed by quiet density during repeated use.

## Colors

The palette is a near-black venue canvas with warm white type and one electric
chartreuse lamp. Coral, blue, amber, and mint are reserved for result meaning.

### Primary

- **Live Lamp** (`#C9FF43`): the mark, active progress, baseline success, and
  the next command.
- **Muted Live Lamp** (`#83A92F`): baseline labels and lower-emphasis brand
  detail.

### Secondary

- **Review Coral** (`#FF665E`): matching successful crossings that require
  human review.
- **Changed Blue** (`#78A8FF`): successful responses whose bodies differ.
- **Warning Amber** (`#F4C95D`): errors and inconclusive outcomes.
- **Success Mint** (`#6EE7A8`): completed stages and clear empty results.

### Neutral

- **Venue Black** (`#0B0D0C`): the explicit canvas in brand assets. The CLI
  respects the user's terminal background instead of painting over it.
- **Warm White** (`#F4F1E9`): primary terminal text.
- **Steel Text** (`#9CA2AB`): supporting information.
- **Steel Faint** (`#5C636D`): labels and tertiary metadata.
- **Rail** (`#343A43`) and **Track** (`#20252A`): dividers and channel lines.

**The Live Lamp Rule.** Bright chartreuse belongs to current work, baseline
access, the mark, and the next safe action. It is not general decoration.

## Typography

Gatecrash uses the terminal's installed monospace at its configured size. The
application does not force a font, tracking value, or text scale. Bold weight,
case, spacing, and rules provide hierarchy without fighting the user's setup.

- **Brand:** lower-case, bold, used in the masthead.
- **Channel label:** short, bold, uppercase, used for stages and result groups.
- **Body:** regular sentence case for paths, explanations, and commands.
- **Data:** regular monospace for status codes, IDs, counts, and timings.

**The Channel Label Rule.** Uppercase is reserved for short section and state
labels. Commands, paths, explanations, and the wordmark remain lower-case.

## Layout

The main composition is a patch field. A compact masthead establishes name and
mode. The current task occupies the center. Summary and next-action rails close
the view without competing with the result.

Spacing is measured in terminal cells: one cell within a tight group, two cells
between channels, and one blank line between sections. The full logo appears at
58 columns and above. The legend stacks below 70 columns. The access matrix
switches from profile columns to stacked route tracks below 78 columns. Content
is capped at 140 columns and remains functional down to 44 columns.

The interface renders inline. It never opens an alternate screen or clears
scrollback. Wide and narrow layouts carry the same route, session, status, and
outcome information.

## Elevation & Depth

The terminal surface is flat and uses no shadows. Indentation, thin rails, and
contrast establish depth. A divider appears only when it connects evidence or
marks a real boundary. Brand SVGs use the same flat construction.

**The Flat Room Rule.** No glow, glass, fake panel shadow, or ornamental border
may substitute for information hierarchy.

## Shapes

The signature shape is a request diamond passing through a split vertical gate.
Rails are straight, corners are sparse, and status lamps are one character.
The terminal uses no rounded containers. The rounded outer frame in the GitHub
banner belongs only to the asset canvas, not to the working interface.

## Components

### Brand masthead

Welcome and active-run views use the three-line gate at 58 columns and above.
Dense result, inspect, explain, and error views use `◆╾┫`. The mark is Live Lamp;
the wordmark is Warm White; the mode is Steel Faint.

### Stage rail

Five fixed labels communicate the complete run: `READ`, `SCOPE`, `REPLAY`,
`COMPARE`, and `REPORT`. A two-frame diamond marks current work, a mint check
marks completion, and a faint dot marks work not started. Replay alone receives
a linear progress bar because it is the long-running stage.

### Access map

Each row starts with a request and ends with one cell per session. A cell always
combines an HTTP status with a symbol. Wide mode aligns profile columns. Narrow
mode keeps the same cells on a wrapped track below each request. Review routes
sort first.

### Finding trace

A review lead connects finding ID, confidence, request, baseline status,
challenger status, similarity, and reason in that order. It is a trace, not a
card. The explain view repeats the trace and adds the evidence list plus a clear
manual-verification warning.

### Next action

The final line starts with a Live Lamp verb such as `next`, `run`, or `fix`, then
shows one copyable command or recovery step. Every command view ends with the
most useful safe action when one exists.

## Do's and Don'ts

### Do:

- **Do** make the next safe action visible at the end of every command.
- **Do** pair every semantic color with a word, number, or glyph.
- **Do** keep a direct visual trace from route to session to outcome.
- **Do** reserve the full logo for welcome and active-run moments.
- **Do** preserve useful output at 44 columns and with color disabled.

### Don't:

- **Don't** turn groups into bordered cards.
- **Don't** use neon glow, gradients, a spinner wall, or decorative animation.
- **Don't** hide security nuance behind playful venue language.
- **Don't** make narrow or colorless terminals feel like fallback products.
- **Don't** clear completed output from scrollback.
