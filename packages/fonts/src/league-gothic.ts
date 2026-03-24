import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'League Gothic',
  importName: 'league-gothic',
  category: 'display',
  weights: [400] as const,
});

export const fontFamily = 'League Gothic' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
