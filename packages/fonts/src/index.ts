export { CANONICAL_FONTS, FONT_ALIASES, GENERIC_FAMILIES, type FontMeta } from "./catalog.js";
export { injectDeterministicFontFaces } from "./inject.js";
export { FONT_DATA } from "./generated/font-data.js";
export { buildFontFace, type FontInfo } from "./base.js";

export function getAvailableFonts() {
  return [
    { fontFamily: 'Inter' as const, importName: 'inter' as const, load: () => import('./inter.js') },
    { fontFamily: 'Montserrat' as const, importName: 'montserrat' as const, load: () => import('./montserrat.js') },
    { fontFamily: 'Outfit' as const, importName: 'outfit' as const, load: () => import('./outfit.js') },
    { fontFamily: 'Nunito' as const, importName: 'nunito' as const, load: () => import('./nunito.js') },
    { fontFamily: 'Oswald' as const, importName: 'oswald' as const, load: () => import('./oswald.js') },
    { fontFamily: 'League Gothic' as const, importName: 'league-gothic' as const, load: () => import('./league-gothic.js') },
    { fontFamily: 'Archivo Black' as const, importName: 'archivo-black' as const, load: () => import('./archivo-black.js') },
    { fontFamily: 'Space Mono' as const, importName: 'space-mono' as const, load: () => import('./space-mono.js') },
    { fontFamily: 'IBM Plex Mono' as const, importName: 'ibm-plex-mono' as const, load: () => import('./ibm-plex-mono.js') },
    { fontFamily: 'JetBrains Mono' as const, importName: 'jetbrains-mono' as const, load: () => import('./jetbrains-mono.js') },
    { fontFamily: 'EB Garamond' as const, importName: 'eb-garamond' as const, load: () => import('./eb-garamond.js') },
  ];
}
