import { FONT_DATA } from './generated/font-data.js';

export type FontInfo = {
  fontFamily: string;
  importName: string;
  category: string;
  weights: readonly number[];
};

export function buildFontFace(info: FontInfo, options?: { weights?: number[] }): string {
  const selectedWeights = options?.weights ?? [...info.weights];
  const blocks: string[] = [];
  for (const weight of selectedWeights) {
    const key = `${info.importName}:${weight}`;
    const dataUri = FONT_DATA[key];
    if (!dataUri) continue;
    blocks.push(`@font-face {
  font-family: '${info.fontFamily}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('${dataUri}') format('woff2');
}`);
  }
  return blocks.join('\n\n');
}
