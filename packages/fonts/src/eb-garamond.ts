import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'EB Garamond',
  importName: 'eb-garamond',
  category: 'serif',
  weights: [400, 700] as const,
});

export const fontFamily = 'EB Garamond' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
