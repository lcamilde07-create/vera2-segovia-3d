import * as THREE from "three";
import { PALETTE } from "../core/palette.js";
import { buildPhaseSurface, profileAt } from "./basins.js";

/**
 * Geosinteticos del vaso 2.
 *
 * El plano especifica una instalacion tipo sandwich sobre el fondo y los
 * taludes: geotextil NT 2000, geomembrana de 60 mils y otra vez geotextil
 * NT 2000. Aqui se representan como tres laminas sobre la superficie excavada
 * de la primera etapa, que es la que el plano recubre.
 *
 * El espesor real (60 mils = 1.5 mm) es invisible a escala del sitio, asi que
 * las laminas se separan unos centimetros solo para poder distinguirlas. Esa
 * separacion es de representacion, no una cota del proyecto.
 */
const SHEETS = [
  { key: "geotextilInferior", label: "Geotextil NT 2000 (inferior)", color: PALETTE.textileLower, lift: 0.05 },
  { key: "geomembrana", label: "Geomembrana 60 mils", color: PALETTE.membrane, lift: 0.35 },
  { key: "geotextilSuperior", label: "Geotextil NT 2000 (superior)", color: PALETTE.textileUpper, lift: 0.65 },
];

/**
 * Zanja de anclaje: el plano la situa a 1 m del hombro del talud, con seccion
 * de 50 x 50 cm.
 */
const ANCHOR_TRENCH_OFFSET_M = 1.0;

export const LINING_SEPARATION_NOTE =
  "Las tres laminas se separan unos centimetros en pantalla para poder verlas; " +
  "en obra van superpuestas (geotextil - geomembrana - geotextil).";

/**
 * Recubrimiento de los tres vasos.
 *
 * La superficie que se recubre es la de la primera etapa de cada vaso: incluye
 * el fondo excavado y la cara interior del dique, que es lo que el plano llama
 * "a fondo y taludes".
 */
export function buildLinings(model, site) {
  const root = new THREE.Group();
  const byKey = new Map();

  for (const [vkey, data] of Object.entries(model.vasos)) {
    const phase = data.fases[0];
    if (!phase) continue;
    const group = buildLiningSheets(data, phase, site);
    if (group.children.length) {
      group.name = vkey;
      group.userData.vaso = vkey;
      root.add(group);
      byKey.set(vkey, group);
    }
  }

  root.userData = { byKey, sheets: SHEETS };
  return root;
}

function buildLiningSheets(data, phase, site) {
  const root = new THREE.Group();
  const base = buildPhaseSurface(data, phase, site, 0);
  if (!base) return root;

  const byKey = new Map();
  for (const sheet of SHEETS) {
    const geometry = base.clone();
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      pos.setY(i, pos.getY(i) + sheet.lift * site.exaggeration);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: sheet.color,
        roughness: sheet.key === "geomembrana" ? 0.46 : 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1,
      })
    );
    mesh.name = sheet.key;
    // Items 4.3 y 4.4: textura de sombreado, sin espesor ni relieve geometrico.
    if (sheet.key !== "geomembrana") mesh.material.onBeforeCompile = shader => {
      shader.vertexShader = "varying vec3 fibraPos;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nfibraPos = position;");
      shader.fragmentShader = "varying vec3 fibraPos;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\nfloat fibra = fract(sin(dot(floor(fibraPos * 70.0),vec3(12.9898,78.233,39.425)))*43758.5453); diffuseColor.rgb *= 0.92 + fibra * 0.08;");
    };
    mesh.userData = { label: sheet.label, pickable: sheet.label };
    mesh.receiveShadow = true;
    root.add(mesh);
    byKey.set(sheet.key, mesh);
  }

  root.userData = { byKey };
  return root;
}

export function buildAnchorTrench(model, site) {
  const root = new THREE.Group();
  for (const [vkey, data] of Object.entries(model.vasos)) {
    const phase = data.fases[0];
    if (!phase) continue;
    const group = trenchFor(data, phase, site);
    group.userData.vaso = vkey;
    if (group.children.length) root.add(group);
  }
  return root;
}

function trenchFor(data, phase, site) {
  const group = new THREE.Group();
  const sections = data.secciones
    .filter((s) => s.surfaces && s.surfaces[phase] && s.terrain)
    .sort((a, b) => a.station - b.station);
  if (sections.length < 2) return group;

  const pts = data.eje.pts;
  const st = data.eje.station;
  const sampler = (station) => {
    let i = 0;
    while (i < st.length - 2 && st[i + 1] < station) i += 1;
    const f = (station - st[i]) / Math.max(st[i + 1] - st[i], 1e-6);
    let dx = pts[i + 1][0] - pts[i][0];
    let dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    return {
      east: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
      north: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      rightE: dy / len,
      rightN: -dx / len,
    };
  };

  /** Hombro del talud: donde la rasante deja de separarse del terreno. */
  const shoulders = (section) => {
    const upper = section.surfaces[phase];
    const lower = section.terrain;
    const offsets = [...new Set([...upper, ...lower].map((p) => p[0]))].sort((a, b) => a - b);
    let lo = null;
    let hi = null;
    for (const o of offsets) {
      if (Math.abs(profileAt(upper, o) - profileAt(lower, o)) > 0.05) {
        if (lo === null) lo = o;
        hi = o;
      }
    }
    return lo === null ? null : [lo, hi];
  };

  for (const side of [-1, 1]) {
    const path = [];
    for (const section of sections) {
      const span = shoulders(section);
      if (!span) continue;
      const edge = side < 0 ? span[0] : span[1];
      const offset = edge + side * ANCHOR_TRENCH_OFFSET_M;
      const a = sampler(section.station);
      const elevation = profileAt(section.terrain, offset);
      if (elevation === null) continue;
      path.push(
        new THREE.Vector3(
          site.x(a.east + a.rightE * offset),
          site.y(elevation) + 0.2,
          site.z(a.north + a.rightN * offset)
        )
      );
    }
    if (path.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(path, false, "centripetal", 0.3);
    const geom = new THREE.TubeGeometry(curve, path.length * 4, 0.3, 6, false);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: 0x8d6e3f, roughness: 0.9 })
    );
    mesh.userData.pickable =
      "Zanja de anclaje 50 x 50 cm, a 1 m del hombro del talud";
    group.add(mesh);
  }
  return group;
}
