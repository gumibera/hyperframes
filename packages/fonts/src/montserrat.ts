import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'Montserrat',
  importName: 'montserrat',
  category: 'sans-serif',
  weights: [400, 700, 900] as const,
});

export const fontFamily = 'Montserrat' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
