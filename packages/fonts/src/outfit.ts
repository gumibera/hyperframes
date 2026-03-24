import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'Outfit',
  importName: 'outfit',
  category: 'sans-serif',
  weights: [400, 700, 900] as const,
});

export const fontFamily = 'Outfit' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
