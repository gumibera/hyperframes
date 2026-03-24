import { buildFontFace, type FontInfo } from './base.js';

export const getInfo = (): FontInfo => ({
  fontFamily: 'Archivo Black',
  importName: 'archivo-black',
  category: 'display',
  weights: [400] as const,
});

export const fontFamily = 'Archivo Black' as const;

export function fontFace(options?: { weights?: number[] }): string {
  return buildFontFace(getInfo(), options);
}
