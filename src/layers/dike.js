import * as THREE from "three";
import { PALETTE } from "../core/palette.js";
import { profileAt } from "./basins.js";

/**
 * Jarillon (terraplen de cierre) de cada vaso.
 *
 * El jarillon es la parte de LLENO de la obra: el tramo donde la rasante del
 * plano queda por encima del terreno natural y retiene los residuos. No es una
 * berma inventada: se lee de las secciones transversales del plano (la misma
 * fuente que el cuerpo de movimiento de tierras y la geomembrana), asi que se
 * apoya exactamente sobre el borde de lleno del vaso, que es donde va la
 * geomembrana "a fondo y taludes".
 *
 * Sobre esa cresta de lleno se dibuja la corona y el talud exterior con las
 * medidas que dio el equipo:
 *   - corona de 4 m de ancho a la cota de la rasante;
 *   - talud 1:2 (1 vertical : 2 horizontal) hacia AFUERA del vaso, bajando
 *     hasta el terreno natural.
 * La corona y el talud exterior se extienden por fuera del vaso: no forman
 * parte de las medidas internas y no llevan chimeneas encima. Son la unica
 * parte parametrica (corona y talud, ajustables); su UBICACION viene del plano.
 */
const CROWN = 4;        // m, ancho de corona (indicacion del equipo)
const SLOPE = 2;        // talud 1:2 -> 2 m horizontal por cada 1 m vertical
const MIN_FILL = 0.6;   // m, lleno minimo para contar como lleno (deteccion del tramo)
const MIN_WIDTH = 6;    // m, ancho minimo del lleno para que sea jarillon y no retoque
const MIN_TOP = 1.2;    // m, altura minima de coronacion del lleno
const MAX_JUMP = 30;    // m, salto maximo de cresta entre secciones contiguas para unirlas

// textura de tierra compactada, como el cuerpo del dique
function earthTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const base = "#" + new THREE.Color(PALETTE.dike).getHexString();
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i += 1) {
    const v = 120 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v * 0.82},${v * 0.6},${0.05 + Math.random() * 0.14})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

/** Interpolador de posicion y perpendicular a lo largo del eje de replanteo. */
function alignmentSampler(eje) {
  const pts = eje.pts;
  const st = eje.station;
  return (station) => {
    let i = 0;
    while (i < st.length - 2 && st[i + 1] < station) i += 1;
    const span = Math.max(st[i + 1] - st[i], 1e-6);
    const f = (station - st[i]) / span;
    let dx = pts[i + 1][0] - pts[i][0];
    let dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    return {
      east: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
      north: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      rightE: dy,   // abscisas positivas a la derecha del sentido de avance
      rightN: -dx,
    };
  };
}

/**
 * Cresta del jarillon en una seccion: el tramo de lleno mas ancho, con su
 * punto mas alto (la coronacion) y hacia que lado desciende el terreno (el
 * lado exterior, donde cae el talud). Devuelve null si la seccion no tiene un
 * lleno apreciable (retoques y llenos diminutos se descartan).
 */
function crestInSection(section, phase) {
  const upper = section.surfaces[phase];
  const lower = section.terrain;
  if (!upper || !lower) return null;
  const offsets = [...new Set([...upper, ...lower].map((p) => p[0]))].sort((a, b) => a - b);

  // tramo contiguo de lleno mas ancho
  let bestLo = null, bestHi = null, bestWidth = -1;
  let curLo = null, curHi = null;
  for (const o of offsets) {
    const fill = profileAt(upper, o) - profileAt(lower, o);
    if (fill > MIN_FILL) {
      if (curLo === null) curLo = o;
      curHi = o;
    } else if (curLo !== null) {
      if (curHi - curLo > bestWidth) { bestWidth = curHi - curLo; bestLo = curLo; bestHi = curHi; }
      curLo = null;
    }
  }
  if (curLo !== null && curHi - curLo > bestWidth) { bestWidth = curHi - curLo; bestLo = curLo; bestHi = curHi; }
  if (bestLo === null || bestWidth < MIN_WIDTH) return null;

  // coronacion = punto mas alto del lleno (la cresta del terraplen)
  let ridgeOffset = bestLo, ridgeFill = -1;
  for (const o of offsets) {
    if (o < bestLo || o > bestHi) continue;
    const fill = profileAt(upper, o) - profileAt(lower, o);
    if (fill > ridgeFill) { ridgeFill = fill; ridgeOffset = o; }
  }
  if (ridgeFill < MIN_TOP) return null;
  const ridgeZ = profileAt(upper, ridgeOffset);

  // lado exterior local = donde el terreno natural queda mas bajo pasado el lleno
  const terrBeyondHi = profileAt(lower, bestHi + 8);
  const terrBeyondLo = profileAt(lower, bestLo - 8);
  const localOuter = terrBeyondHi <= terrBeyondLo ? 1 : -1;

  return { offset: ridgeOffset, crest: ridgeZ, localOuter, lower };
}

export function buildDike(model, site) {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.dike,
    map: earthTexture(),
    roughness: 0.97,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  for (const [vkey, vaso] of Object.entries(model.vasos)) {
    const phase = vaso.fases[0];
    if (!phase) continue;
    const sections = vaso.secciones
      .filter((s) => s.surfaces && s.surfaces[phase] && s.terrain)
      .sort((a, b) => a.station - b.station);
    if (sections.length < 2) continue;

    const sample = alignmentSampler(vaso.eje);

    // cresta cruda por seccion (o null si no hay lleno apreciable ahi)
    const raw = sections.map((sec) => {
      const c = crestInSection(sec, phase);
      return c ? { ...c, station: sec.station } : null;
    });

    // un unico lado exterior por vaso (mayoria de las secciones): evita que la
    // corona y el talud salten de lado a lado y retuerzan la cinta.
    let vote = 0;
    for (const c of raw) if (c) vote += c.localOuter;
    const outerSign = vote >= 0 ? 1 : -1;

    // geometria de cada nodo con ese lado exterior fijo
    const nodes = raw.map((c) => {
      if (!c) return null;
      const a = sample(c.station);
      const en = (offset) => [a.east + a.rightE * offset, a.north + a.rightN * offset];
      const [cx, cn] = en(c.offset);
      // corona plana 4 m hacia afuera, a la cota de la cresta
      const coOff = c.offset + outerSign * CROWN;
      const [ox, on] = en(coOff);
      // pata del talud 1:2 hasta el terreno natural
      const groundCorona = profileAt(c.lower, coOff);
      const drop = Math.max(0, c.crest - groundCorona);
      const toeOff = coOff + outerSign * Math.max(CROWN, SLOPE * drop);
      const [tx, tn] = en(toeOff);
      const toeZ = profileAt(c.lower, toeOff);
      return {
        offset: c.offset,
        crest: [cx, cn, c.crest],
        crownOuter: [ox, on, c.crest],
        toe: [tx, tn, toeZ],
        crestElev: c.crest,
      };
    });

    const positions = [];
    const uvs = [];
    let maxCrest = -Infinity, minCrest = Infinity;
    const P = ([e, n, z]) => {
      const x = site.x(e), zz = site.z(n);
      positions.push(x, site.y(z), zz);
      uvs.push(x / 12, zz / 12);
    };

    // cintas entre secciones contiguas que ambas tengan lleno, sin saltos
    // bruscos de cresta (un salto grande no es el mismo terraplen).
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const A = nodes[i], B = nodes[i + 1];
      if (!A || !B) continue;
      if (Math.abs(A.offset - B.offset) > MAX_JUMP) continue;
      maxCrest = Math.max(maxCrest, A.crestElev, B.crestElev);
      minCrest = Math.min(minCrest, A.crestElev, B.crestElev);
      // corona plana (cresta -> corona exterior)
      P(A.crest); P(A.crownOuter); P(B.crest);
      P(B.crest); P(A.crownOuter); P(B.crownOuter);
      // talud exterior 1:2
      P(A.crownOuter); P(A.toe); P(B.crownOuter);
      P(B.crownOuter); P(A.toe); P(B.toe);
    }

    if (!positions.length) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.vaso = vkey;
    mesh.userData.pickable =
      `Jarillón ${vkey.replace("vaso", "vaso ")} · cresta ${minCrest.toFixed(1)}–${maxCrest.toFixed(1)} m · ` +
      `corona 4 m, talud 1:2 hacia afuera`;
    mesh.userData.visualNote =
      "Terraplén de cierre (zona de lleno del vaso, leída de las secciones del plano). " +
      "Corona 4 m y talud 1:2 hacia afuera según indicación del equipo; la corona y el " +
      "talud exterior no son parte de las medidas internas del vaso ni llevan chimeneas.";
    root.add(mesh);
  }

  return root;
}
