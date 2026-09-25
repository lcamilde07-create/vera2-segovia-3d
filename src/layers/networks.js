import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { PALETTE, networkColor } from "../core/palette.js";
import { profileAt } from "./basins.js";
import { buildOpenChannel } from "./channels.js";

// Cunetas: trazo con grosor en pantalla para que se lean a escala del sitio.
// Una THREE.Line de 1 px es casi invisible sobre el terreno.
const cunetaMaterial = new LineMaterial({
  color: 0x2fd0d8, linewidth: 3, transparent: true, opacity: 0.95,
  depthTest: false, depthWrite: false,   // siempre visibles sobre el terreno
});
function cunetaTrace(points) {
  const pos = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    pos.push(points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  const g = new LineSegmentsGeometry();
  g.setPositions(pos);
  const line = new LineSegments2(g, cunetaMaterial);
  line.renderOrder = 4;
  // LineSegments2 no calcula esfera envolvente: sin esto el frustum culling la
  // descarta, no se dibuja y ni siquiera corre onBeforeRender (resolucion 1x1).
  line.frustumCulled = false;
  line.computeLineDistances();
  line.onBeforeRender = (renderer) => renderer.getSize(cunetaMaterial.resolution);
  return line;
}

/**
 * Proyecta un punto del terreno sobre el eje de un vaso para leer la cota de
 * una superficie de proyecto. Sirve para colgar tuberias y filtros sobre la
 * superficie excavada en vez de sobre el terreno natural.
 */
export class BasinSurface {
  /**
   * @param restrictToSpan  si es cierto, solo devuelve cota dentro del tramo
   *   donde la etapa modifica el terreno. Para colgar tuberias interesa eso;
   *   para saber hasta donde ha subido el relleno en un punto, no, porque la
   *   superficie acumulada de la etapa tambien vale fuera de ese tramo.
   */
  constructor(vaso, phase, restrictToSpan = true) {
    this.vaso = vaso;
    this.phase = phase;
    this.restrictToSpan = restrictToSpan;
    this.segments = [];
    const pts = vaso.eje.pts;
    const st = vaso.eje.station;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      this.segments.push({ e: pts[i][0], n: pts[i][1], ux: dx / len, uy: dy / len, len, s0: st[i] });
    }
    this.sections = vaso.secciones
      .filter((s) => s.surfaces && s.surfaces[phase])
      .sort((a, b) => a.station - b.station)
      .map((s) => ({ station: s.station, profile: s.surfaces[phase], span: spanOf(s, vaso.fases, phase) }))
      .filter((s) => s.span || !restrictToSpan);
  }

  /** Abscisa y distancia al eje de un punto del terreno. */
  project(east, north) {
    let best = null;
    for (const seg of this.segments) {
      const t = Math.max(0, Math.min(seg.len, (east - seg.e) * seg.ux + (north - seg.n) * seg.uy));
      const px = seg.e + seg.ux * t;
      const py = seg.n + seg.uy * t;
      const distance = Math.hypot(east - px, north - py);
      if (!best || distance < best.distance) {
        best = {
          distance,
          station: seg.s0 + t,
          offset: (east - px) * seg.uy - (north - py) * seg.ux,
        };
      }
    }
    return best;
  }

  elevationAt(east, north) {
    const p = this.project(east, north);
    if (!p || this.sections.length === 0) return null;
    let i = 0;
    while (i < this.sections.length - 2 && this.sections[i + 1].station < p.station) i += 1;
    const a = this.sections[i];
    const b = this.sections[Math.min(i + 1, this.sections.length - 1)];
    if (this.restrictToSpan) {
      const inside = (s) => s.span && p.offset >= s.span[0] && p.offset <= s.span[1];
      if (!inside(a) && !inside(b)) return null;
    }
    const za = profileAt(a.profile, p.offset);
    const zb = profileAt(b.profile, p.offset);
    if (za === null) return zb;
    if (zb === null) return za;
    const f = Math.max(0, Math.min(1, (p.station - a.station) / Math.max(b.station - a.station, 1e-6)));
    return za + (zb - za) * f;
  }
}

/** Tramo de la seccion donde la etapa modifica el terreno. */
function spanOf(section, phases, phase) {
  const upper = section.surfaces[phase];
  const rank = phases.indexOf(phase);
  const lower =
    rank > 0 && section.surfaces[phases[rank - 1]] ? section.surfaces[phases[rank - 1]] : section.terrain;
  if (!upper || !lower) return null;
  const offsets = new Set();
  for (const [o] of upper) offsets.add(o);
  for (const [o] of lower) offsets.add(o);
  let lo = null;
  let hi = null;
  for (const o of [...offsets].sort((x, y) => x - y)) {
    if (Math.abs(profileAt(upper, o) - profileAt(lower, o)) > 0.03) {
      if (lo === null) lo = o;
      hi = o;
    }
  }
  return lo === null ? null : [lo, hi];
}

/** Cota de apoyo: la superficie del proyecto si la hay, si no el terreno. */
export function makeDrapeSampler(site, surfaces) {
  return (east, north) => {
    for (const s of surfaces) {
      const z = s.elevationAt(east, north);
      if (z !== null) return z;
    }
    return site.elevationAt(east, north);
  };
}

/**
 * Cota del fondo excavado: la mas baja entre la rasante y el terreno natural.
 *
 * Los filtros interiores van solo en el fondo del vaso. Con el apoyo normal se
 * subian por la cara del dique, porque ahi la rasante queda por encima del
 * terreno; tomando la menor de las dos se quedan donde corresponde.
 */
export function makeBottomSampler(site, surfaces) {
  return (east, north) => {
    const ground = site.elevationAt(east, north);
    let best = null;
    for (const s of surfaces) {
      const z = s.elevationAt(east, north);
      if (z !== null && (best === null || z < best)) best = z;
    }
    if (best === null) return ground;
    if (ground === null) return best;
    return Math.min(best, ground);
  };
}

function cleanPointsFromLine(line, drape, site, lift = 0) {
  const points = [];
  for (const [east, north] of line) {
    const z = drape(east, north);
    if (z === null) continue;
    points.push(new THREE.Vector3(site.x(east), site.y(z) + lift, site.z(north)));
  }
  if (points.length < 2) return null;
  const clean = [points[0]];
  for (const p of points.slice(1)) {
    if (p.distanceTo(clean[clean.length - 1]) > 0.05) clean.push(p);
  }
  if (clean.length < 2) return null;
  return clean;
}

function tubeFromPoints(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.2);
  const segments = Math.min(400, Math.max(12, points.length * 3));
  return new THREE.TubeGeometry(curve, segments, radius, 8, false);
}

function tubeFromLine(line, drape, site, radius, lift) {
  const clean = cleanPointsFromLine(line, drape, site, lift);
  if (!clean) return null;
  return tubeFromPoints(clean, radius);
}

const BOTTOM_ONLY = new Set(["tuberia6", "tuberia10"]);
const FILTER_KEYS = new Set(["tuberia6", "tuberia10"]);
const FILTER_HEIGHT = 0.78;
// El plano publica la altura del filtro y el eje en planta, pero no su ancho:
// se dibuja una franja simbolica para que el usuario lea el detalle completo.
const FILTER_SYMBOL_WIDTH = 1.1;

function tangentAt(points, i) {
  const prev = points[Math.max(0, i - 1)];
  const next = points[Math.min(points.length - 1, i + 1)];
  const tangent = next.clone().sub(prev).setY(0);
  if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
  return tangent.normalize();
}

function buildFilterBody(points, site) {
  const positions = [];
  const colors = [];
  const indices = [];
  const bottomColor = new THREE.Color(PALETTE.stone).multiplyScalar(0.7);
  const topColor = new THREE.Color(PALETTE.stone);
  const half = FILTER_SYMBOL_WIDTH / 2;

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const t = tangentAt(points, i);
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    const left = p.clone().addScaledVector(right, -half);
    const rightPoint = p.clone().addScaledVector(right, half);
    const topLeft = left.clone().setY(left.y + FILTER_HEIGHT * site.exaggeration);
    const topRight = rightPoint.clone().setY(rightPoint.y + FILTER_HEIGHT * site.exaggeration);
    for (const [v, c] of [
      [left, bottomColor],
      [rightPoint, bottomColor],
      [topLeft, topColor],
      [topRight, topColor],
    ]) {
      positions.push(v.x, v.y, v.z);
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = i * 4;
    const b = a + 4;
    indices.push(a, b, a + 2, a + 2, b, b + 2);
    indices.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
    indices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
  }
  for (const base of [0, (points.length - 1) * 4]) {
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildFilterMeshLines(points, site) {
  const positions = [];
  const half = FILTER_SYMBOL_WIDTH / 2 + 0.015;
  const step = Math.max(1, Math.floor(points.length / 18));
  const add = (a, b) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z);

  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const t = tangentAt(points, i);
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    const left = p.clone().addScaledVector(right, -half);
    const rightPoint = p.clone().addScaledVector(right, half);
    const topLeft = left.clone().setY(left.y + FILTER_HEIGHT * site.exaggeration);
    const topRight = rightPoint.clone().setY(rightPoint.y + FILTER_HEIGHT * site.exaggeration);
    add(left, topLeft);
    add(rightPoint, topRight);
    add(topLeft, topRight);
  }
  for (let i = 0; i < points.length - 1; i += step) {
    const j = Math.min(points.length - 1, i + step);
    const a = points[i];
    const b = points[j];
    const ra = new THREE.Vector3(tangentAt(points, i).z, 0, -tangentAt(points, i).x).normalize();
    const rb = new THREE.Vector3(tangentAt(points, j).z, 0, -tangentAt(points, j).x).normalize();
    add(
      a.clone().addScaledVector(ra, -half).setY(a.y + FILTER_HEIGHT * site.exaggeration),
      b.clone().addScaledVector(rb, half).setY(b.y + FILTER_HEIGHT * site.exaggeration)
    );
    add(
      a.clone().addScaledVector(ra, half).setY(a.y + FILTER_HEIGHT * site.exaggeration),
      b.clone().addScaledVector(rb, -half).setY(b.y + FILTER_HEIGHT * site.exaggeration)
    );
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geom,
    new THREE.LineBasicMaterial({
      color: PALETTE.textileLower,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    })
  );
}

function nearestManhole(linePoint, manholes) {
  if (!manholes || !manholes.length) return null;
  let best = null;
  for (const p of manholes) {
    const d = Math.hypot(linePoint[0] - p.east, linePoint[1] - p.north);
    if (!best || d < best.distance) best = { ...p, distance: d };
  }
  return best;
}

function lineFlowsForward(line, points, manholes) {
  const firstOutlet = nearestManhole(line[0], manholes);
  const lastOutlet = nearestManhole(line[line.length - 1], manholes);
  if (firstOutlet && lastOutlet && Math.min(firstOutlet.distance, lastOutlet.distance) < 70) {
    if (Math.abs(firstOutlet.elev - lastOutlet.elev) > 0.05) return lastOutlet.elev < firstOutlet.elev;
    return lastOutlet.distance < firstOutlet.distance;
  }
  return points[points.length - 1].y < points[0].y;
}

function buildFlowArrows(line, points, model, color) {
  const group = new THREE.Group();
  const forward = lineFlowsForward(line, points, model.puntos && model.puntos.pozos);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.05,
    emissive: new THREE.Color(color).multiplyScalar(0.18),
  });
  const cone = new THREE.ConeGeometry(0.32, 1.15, 16);
  const count = Math.max(1, Math.min(5, Math.floor(points.length / 4)));
  for (let i = 1; i <= count; i += 1) {
    const raw = i / (count + 1);
    const idx = Math.max(0, Math.min(points.length - 2, Math.round(raw * (points.length - 1))));
    const p = points[idx].clone();
    p.y += FILTER_HEIGHT * 0.82;
    const dir = tangentAt(points, idx).multiplyScalar(forward ? 1 : -1);
    const arrow = new THREE.Mesh(cone, material);
    arrow.position.copy(p);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    arrow.userData.pickable = "Sentido de flujo por gravedad hacia pozo de menor cota";
    arrow.userData.screenHeight = 9 / 1.15;
    group.add(arrow);
  }
  return group;
}

function buildDownhillArrows(points, color, label, lift = 0.55) {
  const group = new THREE.Group();
  if (!points || points.length < 2) return group;
  const forward = points[points.length - 1].y <= points[0].y;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.04,
    emissive: new THREE.Color(color).multiplyScalar(0.16),
  });
  const cone = new THREE.ConeGeometry(0.24, 0.85, 14);
  const count = Math.max(1, Math.min(4, Math.floor(points.length / 6)));
  for (let i = 1; i <= count; i += 1) {
    const idx = Math.max(0, Math.min(points.length - 2, Math.round((i / (count + 1)) * (points.length - 1))));
    const p = points[idx].clone();
    p.y += lift;
    const dir = tangentAt(points, idx).multiplyScalar(forward ? 1 : -1).normalize();
    const arrow = new THREE.Mesh(cone, material);
    arrow.position.copy(p);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arrow.userData.pickable = label;
    arrow.userData.screenHeight = 8 / 0.85;
    group.add(arrow);
  }
  return group;
}

function buildFilterLine(line, sampler, site, model, net) {
  const bottom = cleanPointsFromLine(line, sampler, site, 0);
  if (!bottom) return null;
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    buildFilterBody(bottom, site),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    })
  );
  body.receiveShadow = true;
  body.castShadow = true;
  body.userData.pickable =
    `Filtro de lixiviados · altura real ${FILTER_HEIGHT.toFixed(2)} m · ${net.label}`;
  group.add(body);
  body.userData.filterPart = "filtro";
  const cage = buildFilterMeshLines(bottom, site);
  cage.userData.filterPart = "filtro";
  group.add(cage);

  const pipePoints = bottom.map((p) => p.clone().setY(p.y + net.radius * site.exaggeration));
  const pipe = new THREE.Mesh(
    tubeFromPoints(pipePoints, net.radius),
    new THREE.MeshStandardMaterial({
      color: networkColor(net.radius > 0.1 ? "tuberia10" : "tuberia6"),
      roughness: 0.38,
      metalness: 0.08,
      emissive: new THREE.Color(net.color).multiplyScalar(0.18),
    })
  );
  pipe.castShadow = true;
  pipe.userData.pickable = `${net.label} · diametro real ${(net.radius * 2).toFixed(3)} m`;
  group.add(pipe);
  pipe.userData.filterPart = "tuberia";
  const arrows = buildFlowArrows(line, bottom, model, net.color);
  arrows.userData.filterPart = "flujo";
  group.add(arrows);
  return group;
}

export function buildNetworks(model, site, drape, bottomDrape) {
  const root = new THREE.Group();
  const byKey = new Map();

  for (const [key, net] of Object.entries(model.redes)) {
    // los filtros interiores se apoyan en el fondo, no sobre el dique
    const sampler = BOTTOM_ONLY.has(key) && bottomDrape ? bottomDrape : drape;
    const group = new THREE.Group();
    group.name = key;
    group.userData = { label: net.label, color: net.color };
    const material = new THREE.MeshStandardMaterial({
      color: networkColor(key),
      roughness: 0.45,
      metalness: 0.15,
      emissive: new THREE.Color(net.color).multiplyScalar(0.12),
    });
    for (const line of net.lines) {
      if (key === "aguasLluvias") {
        group.add(buildOpenChannel(line, sampler, site));
      } else if (key === "cuneta") {
        const points = cleanPointsFromLine(line, sampler, site, 0.25);
        if (!points) continue;
        const trace = cunetaTrace(points);
        trace.userData.pickable = "Cuneta: traza del levantamiento, sección no documentada";
        group.add(trace);
      } else if (FILTER_KEYS.has(key)) {
        const filter = buildFilterLine(line, sampler, site, model, net);
        if (filter) group.add(filter);
      } else {
        const points = cleanPointsFromLine(line, sampler, site, 0.35);
        if (!points) continue;
        // Realce de lectura a escala de conjunto, no diametro constructivo.
        const RADIO_EXTERIOR_VISUAL_MINIMO = 0.25;
        const geom = tubeFromPoints(points, Math.max(net.radius, RADIO_EXTERIOR_VISUAL_MINIMO));
        if (!geom) continue;
        const mesh = new THREE.Mesh(geom, material);
        mesh.castShadow = true;
        mesh.userData.pickable = net.label;
        mesh.userData.visualNote = `Diametro real ${(net.radius * 2).toFixed(3)} m; diametro dibujado ${Math.max(net.radius * 2, RADIO_EXTERIOR_VISUAL_MINIMO * 2).toFixed(2)} m. Realce exterior de representacion, no cota de obra; eje elevado 0,35 m sobre el muestreo.`;
        group.add(mesh);
        if (key === "aguasLluvias" || key === "cuneta") {
          group.add(buildDownhillArrows(points, net.color, `${net.label} · sentido segun pendiente del terreno`, 0.55));
        }
      }
    }
    if (group.children.length) {
      root.add(group);
      byKey.set(key, group);
    }
  }
  root.userData = { byKey };
  return root;
}

/** Pozos de inspeccion con su cota de fondo real publicada en el plano. */
export function buildManholes(model, site, drape) {
  const group = new THREE.Group();
  const unresolved = [];
  // Item 4.12: diametro interior variable. Estas medidas solo explican la forma.
  const POZO_DIAMETRO_VISUAL = 1.8;
  const CONO_ALTURA_VISUAL = 0.6;
  const TAPA_DIAMETRO_VISUAL = 0.7;
  const shell = new THREE.MeshStandardMaterial({
    color: PALETTE.concrete,
    roughness: 0.95,
    metalness: 0,
  });
  // tapa de fundición del manhole (anillo + tapa oscura) para que se lea como
  // una cámara real; encima, las iniciales pequeñas del MH
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.55, metalness: 0.45 });
  // material del marcador (pin) del MH: se dibuja SIEMPRE por encima del
  // terreno y del vuelo de dron para poder localizarlo, aunque la camara este
  // lejos o la camara quede dentro del vaso.
  const BEACON_H = 8;      // m, alto del poste-marcador sobre la tapa
  const MH_TOP_RADIUS = 3; // m, radio visual de la tapa del MH (~6 m de diametro)
  const MH_DRUM_H = 1.4;   // m, alto del tambor que sobresale del terreno
  // la camara del MH se dibuja por encima del terreno (depthTest:false) para que
  // no quede enterrada donde la malla del terreno o del dron pasa por encima de
  // la cota de la boca; renderOrder por debajo del pin para que el pin gane.
  const mhBodyMat = new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.9, metalness: 0, depthTest: false });
  const mhIronMat = new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.55, metalness: 0.45, depthTest: false });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf2b705, depthTest: false, depthWrite: false, transparent: true });
  const makeInitials = (text) => {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(18,26,32,0.9)";
    g.beginPath(); g.roundRect(4, 12, 120, 40, 9); g.fill();
    g.strokeStyle = "#f2b705"; g.lineWidth = 3; g.stroke();
    g.fillStyle = "#ffe08a"; g.font = "bold 30px 'Segoe UI',sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 64, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    // depthTest:false -> el rotulo se ve a traves del terreno; renderOrder alto
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set(4.2, 2.1, 1);
    sp.renderOrder = 12;
    return sp;
  };
  const addManholeTop = (x, ytop, z, radius, id) => {
    const note = `MH ${id} · cámara de salida de lixiviado (tamaño visual 6 m para lectura)`;
    // camara a escala visual ~6 m de diametro: la real es menor, pero se agranda
    // para que el MH se lea a distancia (indicacion del equipo). No es cota del
    // plano. Se levanta como un tambor que sobresale del terreno para que no
    // quede escondido a ras de suelo.
    const topR = MH_TOP_RADIUS;
    const drumH = MH_DRUM_H * site.exaggeration;
    // cuerpo (brocal de concreto) que sobresale del suelo, dibujado por encima
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR, drumH, 32), mhBodyMat);
    drum.position.set(x, ytop + drumH / 2, z); drum.renderOrder = 9;
    // aro y tapa de fundicion encima del tambor
    const rim = new THREE.Mesh(new THREE.TorusGeometry(topR + 0.2, 0.32, 10, 28), mhIronMat);
    rim.rotation.x = -Math.PI / 2; rim.position.set(x, ytop + drumH + 0.04, z); rim.renderOrder = 10;
    const cover = new THREE.Mesh(new THREE.CircleGeometry(topR, 32), mhIronMat);
    cover.rotation.x = -Math.PI / 2; cover.position.set(x, ytop + drumH + 0.06, z); cover.renderOrder = 10;

    // pin siempre visible: poste fino + cabeza, para localizar el MH a distancia
    const h = drumH + BEACON_H * site.exaggeration;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, h - drumH, 8), beaconMat);
    post.position.set(x, ytop + drumH + (h - drumH) / 2, z); post.renderOrder = 11;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), beaconMat);
    head.position.set(x, ytop + h, z); head.renderOrder = 11;

    const label = makeInitials(id);
    label.position.set(x, ytop + h + 1.6 * site.exaggeration, z);

    drum.userData.pickable = rim.userData.pickable = cover.userData.pickable =
      label.userData.pickable = post.userData.pickable = head.userData.pickable = note;
    group.add(drum, rim, cover, post, head, label);
  };
  for (const pozo of model.puntos.pozos || []) {
    const top = site.elevationAt(pozo.east, pozo.north);
    if (top === null || !Number.isFinite(pozo.elev) || top <= pozo.elev) {
      unresolved.push(`${pozo.id}: fondo ${pozo.elev}, MDT ${top === null ? "fuera de cobertura" : top.toFixed(2)}; profundidad no positiva o no resoluble`);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.5),shell);
      marker.position.set(site.x(pozo.east),site.y(pozo.elev),site.z(pozo.north));
      marker.userData = {pickable:`Pozo ${pozo.id} · fondo publicado ${pozo.elev.toFixed(2)} m`,visualNote:unresolved.at(-1)+". Solo marcador, sin altura inventada.",screenHeight:8};
      group.add(marker);
      continue;
    }
    const depth = top - pozo.elev;
    const cone = depth > 2 ? CONO_ALTURA_VISUAL : 0;
    const height = depth - cone;
    // Espesor publicado en 4.12: 0,20 m hasta 3,60 m; 0,25 m despues.
    const radius = POZO_DIAMETRO_VISUAL / 2 + (depth <= 3.6 ? 0.2 : 0.25);
    const geom = new THREE.CylinderGeometry(radius, radius, height * site.exaggeration, 24);
    const mesh = new THREE.Mesh(geom, shell);
    mesh.position.set(
      site.x(pozo.east),
      site.y(pozo.elev) + (height * site.exaggeration) / 2,
      site.z(pozo.north)
    );
    mesh.castShadow = true;
    mesh.userData.pickable = `Pozo ${pozo.id} · fondo ${pozo.elev.toFixed(2)} m · profundidad MDT ${depth.toFixed(2)} m`;
    mesh.userData.visualNote = "Item 4.12. Diametro interior visual 1,80 m; cono visual 0,60 m; tapa visual 0,70 m. No son cotas del plano. Tapa apoyada en el MDT; fondo publicado.";
    mesh.userData.pozo = pozo;
    group.add(mesh);
    if (cone) {
      const geometry = new THREE.CylinderGeometry(TAPA_DIAMETRO_VISUAL/2, radius, cone*site.exaggeration,24);
      const pos = geometry.attributes.position;
      const eccentricity = radius-TAPA_DIAMETRO_VISUAL/2;
      for(let i=0;i<pos.count;i++)pos.setX(i,pos.getX(i)+eccentricity*(pos.getY(i)/(cone*site.exaggeration)+0.5));
      geometry.computeVertexNormals();
      const reducer=new THREE.Mesh(geometry,shell);reducer.position.set(mesh.position.x,site.y(top-cone/2),mesh.position.z);reducer.userData={...mesh.userData};group.add(reducer);
    }
    const lid=new THREE.Mesh(new THREE.CircleGeometry(cone?TAPA_DIAMETRO_VISUAL/2:radius,24),shell);
    lid.rotation.x=-Math.PI/2;lid.position.set(mesh.position.x+(cone?radius-TAPA_DIAMETRO_VISUAL/2:0),site.y(top),mesh.position.z);lid.userData={...mesh.userData};group.add(lid);
    addManholeTop(lid.position.x, site.y(top), mesh.position.z,
      cone ? TAPA_DIAMETRO_VISUAL / 2 : radius, pozo.id);
  }
  group.userData.unresolved = unresolved;
  return group;
}

/** Puntos topograficos CH1..CH8 publicados en el plano de geosinteticos. */
export function buildSurveyPoints(model, site, drape) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.survey,
    emissive: 0x6b5010,
    roughness: 0.4,
  });
  for (const p of model.puntos.topograficosVaso2) {
    const z = drape(p.east, p.north);
    if (z === null) continue;
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), material);
    mesh.position.set(site.x(p.east), site.y(z), site.z(p.north));
    mesh.userData.markerId = p.id;
    mesh.userData.pickable = `${p.id} - E ${p.east.toFixed(3)} / N ${p.north.toFixed(3)}`;
    group.add(mesh);
  }
  return group;
}

export function buildPlanimetry(model, site, drape = null) {
  // por defecto se cuelga del terreno natural; con el vuelo de dron activo se
  // le pasa un drapeado que posa las lineas sobre el suelo del levantamiento
  const ground = drape || ((east, north) => site.elevationAt(east, north));
  const root = new THREE.Group();
  const byKey = new Map();
  for (const [key, layer] of Object.entries(model.planimetria)) {
    const positions = [];
    for (const line of layer.lines) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const z0 = ground(line[i][0], line[i][1]);
        const z1 = ground(line[i + 1][0], line[i + 1][1]);
        if (z0 === null || z1 === null) continue;
        positions.push(
          site.x(line[i][0]), site.y(z0) + 0.6, site.z(line[i][1]),
          site.x(line[i + 1][0]), site.y(z1) + 0.6, site.z(line[i + 1][1])
        );
      }
    }
    if (!positions.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(layer.color),
        transparent: true,
        opacity: 0.9,
      })
    );
    lines.name = key;
    lines.userData = { label: layer.label, color: layer.color, pickable: layer.label };
    root.add(lines);
    byKey.set(key, lines);
  }
  root.userData = { byKey };
  return root;
}
