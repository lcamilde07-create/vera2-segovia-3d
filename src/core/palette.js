import * as THREE from "three";

// Matiz estable por vaso; la luminosidad aumenta con la etapa, no la saturacion.
export const PALETTE = Object.freeze({
  basins: { vaso1: [0xad844c, 0xbe995f, 0xd0af7b, 0xdfc59a],
    vaso2: [0x467f7a, 0x609791, 0x81afa6, 0xa2c5bc],
    vaso3: [0x76668e, 0x9380a5, 0xae9bbe, 0xc4b5d0] },
  dike: 0xab8965, excavation: 0x829499, membrane: 0x363e43,
  textileLower: 0xc7cdca, textileUpper: 0xe3e5df,
  stone: 0x929183, cage: 0xcbd2ce, pipe6: 0xaf7690, pipe10: 0x766149,
  channel: 0x9c947c, water: 0x729aaf, concrete: 0xaeb4b2,
  road: 0x929797, survey: 0xddb554, interpolated: 0x4a555e,
  contour: 0x59644a, contourMajor: 0x46503d, edge: 0xd8d0be,
  skirtTop: 0x7a6650, skirtBottom: 0x3a3027,
  terrainRamp: [[0,0x3f6b4a],[0.25,0x5f8a4e],[0.5,0x92a25b],[0.72,0xb99a68],[0.88,0xa38b72],[1,0x8f7c66]],
});
export const PHASE_STYLE = Object.fromEntries(Object.entries(PALETTE.basins).flatMap(([vaso, colors]) =>
  colors.map((color, i) => [`${vaso}/${i + 1}`, { color, label: `Vaso ${vaso.slice(-1)} · Etapa ${i + 1}` }])));

export function earthColor(base, fill) {
  const color = new THREE.Color(base);
  return fill ? color.lerp(new THREE.Color(0xd4c9ae), 0.22)
    : color.lerp(new THREE.Color(0x34474d), 0.23);
}
export const cssColor = color => `#${new THREE.Color(color).getHexString()}`;
export function networkColor(key) {
  return ({ tuberia6: PALETTE.pipe6, tuberia10: PALETTE.pipe10,
    aguasLluvias: PALETTE.channel, cuneta: PALETTE.water, zanjaAnclaje: PALETTE.edge })[key] ?? PALETTE.water;
}
