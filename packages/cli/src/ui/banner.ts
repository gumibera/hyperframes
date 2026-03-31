import { isColorSupported } from "./colors.js";

// ---------------------------------------------------------------------------
// Gradient stops: teal → indigo → purple → magenta → pink
// ---------------------------------------------------------------------------

const GRADIENT: [number, number, number][] = [
  [72, 191, 227], // teal
  [93, 96, 206], // indigo
  [114, 9, 183], // purple
  [181, 23, 158], // magenta
  [247, 37, 133], // pink
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function gradientColor(t: number): [number, number, number] {
  const segments = GRADIENT.length - 1;
  const scaled = t * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const frac = scaled - i;
  const a = GRADIENT[i]!;
  const b = GRADIENT[i + 1]!;
  return [lerp(a[0], b[0], frac), lerp(a[1], b[1], frac), lerp(a[2], b[2], frac)];
}

function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

// ---------------------------------------------------------------------------
// Block-letter art: HYPER + FRAMES (5 rows each)
// ---------------------------------------------------------------------------

const HYPER = [
  "██   ██ ██    ██ ██████  ███████ ██████  ",
  "██   ██  ██  ██  ██   ██ ██      ██   ██ ",
  "████████  ████   ██████  █████   ██████  ",
  "██   ██    ██    ██      ██      ██   ██ ",
  "██   ██    ██    ██      ███████ ██   ██ ",
];

const FRAMES = [
  "███████ ██████   █████  ███    ███ ███████ ███████",
  "██      ██   ██ ██   ██ ████  ████ ██      ██     ",
  "█████   ██████  ███████ ██ ████ ██ █████   ███████",
  "██      ██   ██ ██   ██ ██  ██  ██ ██           ██",
  "██      ██   ██ ██   ██ ██      ██ ███████ ███████",
];

// ---------------------------------------------------------------------------
// Logo: simplified code-play icon ◇ ◆ ◇
// ---------------------------------------------------------------------------

function printGradientRow(row: string, maxWidth: number): string {
  let line = "";
  for (let col = 0; col < row.length; col++) {
    const ch = row[col];
    if (!ch || ch === " ") {
      line += " ";
      continue;
    }
    const t = maxWidth > 1 ? col / (maxWidth - 1) : 0;
    const [r, g, b] = gradientColor(t);
    line += rgb(r, g, b, ch);
  }
  return line;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function printBanner(): void {
  if (!isColorSupported || !process.stdout.isTTY) return;

  const maxWidth = Math.max(...HYPER.map((r) => r.length), ...FRAMES.map((r) => r.length));

  // Logo centered above text
  const [lr, lg, lb] = gradientColor(0.5);
  const logo = "◇ ◆ ◇";
  const logoPad = Math.max(0, Math.floor((maxWidth - logo.length) / 2));

  console.log();
  console.log("  " + " ".repeat(logoPad) + rgb(lr, lg, lb, logo));
  console.log();

  for (const row of HYPER) {
    console.log("  " + printGradientRow(row, maxWidth));
  }
  for (const row of FRAMES) {
    console.log("  " + printGradientRow(row, maxWidth));
  }

  console.log();
}
