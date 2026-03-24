import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'Oswald',
  importName: 'oswald',
  category: 'display',
  weights: [400, 700] as const,
});

export const fontFamily = 'Oswald' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
