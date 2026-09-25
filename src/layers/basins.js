import * as THREE from "three";
import { PALETTE, PHASE_STYLE, earthColor } from "../core/palette.js";

/**
 * Vasos por fase, reconstruidos desde las secciones transversales del plano.
 *
 * Cada seccion trae el terreno natural y la superficie resultante despues de
 * cada etapa. El cuerpo de una etapa es el solido entre la superficie de la
 * etapa anterior y la suya, limitado a los tramos donde ambas difieren: ahi es
 * donde hay movimiento de tierras. Las secciones se situan en el espacio sobre
 * el eje de replanteo, perpendiculares a el.
 */

export { PHASE_STYLE };

const CAP_SAMPLES = 80;
const MIN_DIFFERENCE = 0.03; // m: por debajo de esto se considera que no hay obra
const MIN_DIKE_HEIGHT = 0.4; // m: altura minima para considerarlo dique y no retoque

// El dique o jarillon es la parte de lleno de la obra: donde la rasante queda
// por encima del terreno. Es el talud que retiene los residuos y cierra el
// vaso por su lado bajo, y el plano lo impermeabiliza igual que el fondo.
export const DIKE_COLOR = PALETTE.dike;

function makeTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = kind === "cover" ? "#efe4cd" : kind === "dike" ? "#e6d4c2" : "#e4e0ca";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 1800; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = Math.random() * (kind === "cover" ? 1.4 : 2.2) + 0.3;
    const shade = kind === "waste" ? 185 + Math.random() * 45 : 198 + Math.random() * 35;
    ctx.fillStyle = `rgba(${shade},${shade * 0.95},${shade * 0.82},${0.08 + Math.random() * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (kind === "cover") {
    ctx.strokeStyle = "rgba(74, 58, 37, 0.08)";
    ctx.lineWidth = 1.2;
    for (let y = 24; y < canvas.height; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(y) * 3);
      ctx.bezierCurveTo(70, y - 8, 150, y + 9, canvas.width, y - 2);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 4);
  texture.anisotropy = 8;
  return texture;
}

const WASTE_TEXTURE = makeTexture("waste");
const COVER_TEXTURE = makeTexture("cover");
const DIKE_TEXTURE = makeTexture("dike");

/** Interpolador de posicion y vector perpendicular a lo largo del eje. */
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
      // abscisas positivas a la derecha del sentido de avance
      rightE: dy,
      rightN: -dx,
    };
  };
}

/** Cota de un perfil (abscisa, cota) en una abscisa dada. */
export function profileAt(profile, offset) {
  if (!profile || profile.length === 0) return null;
  if (offset <= profile[0][0]) return profile[0][1];
  const last = profile[profile.length - 1];
  if (offset >= last[0]) return last[1];
  let lo = 0;
  let hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid][0] <= offset) lo = mid;
    else hi = mid;
  }
  const [o0, z0] = profile[lo];
  const [o1, z1] = profile[hi];
  return z0 + ((z1 - z0) * (offset - o0)) / (o1 - o0 || 1e-6);
}

/** Superficie anterior a una etapa: la de la etapa previa, o el terreno. */
function lowerProfile(section, phases, phase) {
  const rank = phases.indexOf(phase);
  if (rank > 0) {
    const prev = section.surfaces && section.surfaces[phases[rank - 1]];
    if (prev) return prev;
  }
  return section.terrain;
}

/** Tramo de abscisas donde la etapa modifica el terreno. */
function activeSpan(upper, lower) {
  const offsets = new Set();
  for (const [o] of upper) offsets.add(o);
  for (const [o] of lower) offsets.add(o);
  const sorted = [...offsets].sort((a, b) => a - b);
  let lo = null;
  let hi = null;
  for (const o of sorted) {
    if (Math.abs(profileAt(upper, o) - profileAt(lower, o)) > MIN_DIFFERENCE) {
      if (lo === null) lo = o;
      hi = o;
    }
  }
  return lo === null ? null : [lo, hi];
}

function phaseRings(vaso, phase, cumulative = false) {
  const phases = vaso.fases;
  const rings = [];
  for (const section of vaso.secciones) {
    const upper = section.surfaces && section.surfaces[phase];
    if (!upper) continue;
    const lower = cumulative ? section.terrain : lowerProfile(section, phases, phase);
    if (!lower) continue;
    const span = activeSpan(upper, lower);
    if (!span) continue;
    rings.push({ station: section.station, upper, lower, span });
  }
  return rings;
}

/** Tramos de la seccion donde la rasante queda por encima del terreno. */
function fillIntervals(upper, lower, span) {
  const [o0, o1] = span;
  const marks = new Set([o0, o1]);
  for (const [o] of upper) if (o > o0 && o < o1) marks.add(o);
  for (const [o] of lower) if (o > o0 && o < o1) marks.add(o);
  const offsets = [...marks].sort((a, b) => a - b);

  const intervals = [];
  let start = null;
  for (const o of offsets) {
    const high = profileAt(upper, o) - profileAt(lower, o) > MIN_DIFFERENCE;
    if (high && start === null) start = o;
    if (!high && start !== null) {
      intervals.push([start, o]);
      start = null;
    }
  }
  if (start !== null) intervals.push([start, o1]);

  return intervals
    .map(([a, b]) => {
      let height = 0;
      for (let i = 0; i <= 12; i += 1) {
        const o = a + ((b - a) * i) / 12;
        height = Math.max(height, profileAt(upper, o) - profileAt(lower, o));
      }
      return { span: [a, b], height };
    })
    .filter((f) => f.span[1] - f.span[0] > 1 && f.height >= MIN_DIKE_HEIGHT);
}

/**
 * Cuerpo del dique: el lleno de la etapa, que es el jarillon que cierra el
 * vaso por abajo. Se recorta cada triangulo por rasante >= terreno: elegir
 * solo el mayor intervalo de cada perfil unia rellenos separados con picos.
 */
function buildDikeBody(vaso, phase, site) {
  const sampler = alignmentSampler(vaso.eje);
  const rings = phaseRings(vaso, phase);
  if (rings.length < 2) return null;

  const positions = [];
  const uvs = [];
  const boundary = new Map();
  let maxHeight = 0;
  let renderVolume = 0;
  const vertex = (ring, o) => {
    const a = sampler(ring.station);
    const upper = profileAt(ring.upper, o), lower = profileAt(ring.lower, o);
    maxHeight = Math.max(maxHeight, upper - lower);
    return { x: site.x(a.east + a.rightE * o), z: site.z(a.north + a.rightN * o),
      upper: site.y(upper), lower: site.y(lower), h: upper - lower };
  };
  const emit = (a, b, c, side) => {
    for (const p of [a, b, c]) { positions.push(p.x, p[side], p.z); uvs.push(p.x / 20, p.z / 20); }
  };
  const id = p => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;
  const addTriangle = triangle => {
    const poly = [];
    for (let i = 0; i < 3; i += 1) {
      const a = triangle[i], b = triangle[(i + 1) % 3];
      if (a.h > 0) poly.push(a);
      if ((a.h > 0) !== (b.h > 0)) {
        const f = a.h / (a.h - b.h);
        const p = {};
        for (const k of ["x", "z", "upper", "lower"]) p[k] = a[k] + (b[k] - a[k]) * f;
        p.h = 0;
        poly.push(p);
      }
    }
    if (poly.length < 3) return;
    for (let i = 1; i < poly.length - 1; i += 1) {
      const a = poly[0], b = poly[i], c = poly[i + 1];
      const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
      renderVolume += area * (a.h + b.h + c.h) / 3;
      emit(poly[0], poly[i], poly[i + 1], "upper");
      emit(poly[0], poly[i + 1], poly[i], "lower");
    }
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const key = [id(a), id(b)].sort().join("|");
      if (boundary.has(key)) boundary.delete(key); else boundary.set(key, [a, b]);
    }
  };
  // Misma triangulacion que la rasante: un muestreo diferente generaba caras
  // que atravesaban la geomembrana entre dos secciones aunque coincidieran en ellas.
  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = rings[r], b = rings[r + 1];
    const offset = (ring, i) => ring.span[0] + (ring.span[1] - ring.span[0]) * i / (CAP_SAMPLES - 1);
    for (let i = 0; i < CAP_SAMPLES - 1; i += 1) {
      const p = vertex(a, offset(a, i)), q = vertex(a, offset(a, i + 1));
      const s = vertex(b, offset(b, i)), t = vertex(b, offset(b, i + 1));
      addTriangle([p, s, q]);
      addTriangle([q, s, t]);
    }
  }
  for (const [a, b] of boundary.values()) {
    if (a.h < 1e-7 && b.h < 1e-7) continue;
    const c = { ...a, upper: a.lower }, d = { ...b, upper: b.lower };
    emit(a, c, b, "upper");
    emit(b, c, d, "upper");
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData = {
    stations: rings.map((r) => r.station),
    maxHeight,
    renderVolume,
  };
  return geometry;
}

function buildPhaseBody(vaso, phase, site, baseColor) {
  const sampler = alignmentSampler(vaso.eje);
  const rings = phaseRings(vaso, phase);
  if (rings.length < 2) return null;

  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const ringSize = CAP_SAMPLES * 2;
  // el lleno se tine hacia el color de dique, para que se distinga del corte
  const cutColor = earthColor(baseColor, false);
  const fillColor = earthColor(baseColor, true);

  for (const ring of rings) {
    const a = sampler(ring.station);
    const [o0, o1] = ring.span;
    const place = (offset, elevation) => {
      positions.push(
        site.x(a.east + a.rightE * offset),
        site.y(elevation),
        site.z(a.north + a.rightN * offset)
      );
      const c = profileAt(ring.upper, offset) - profileAt(ring.lower, offset) > MIN_DIFFERENCE
        ? fillColor
        : cutColor;
      colors.push(c.r, c.g, c.b);
      uvs.push((ring.station % 90) / 90, (offset - o0) / Math.max(o1 - o0, 1));
    };
    for (let i = 0; i < CAP_SAMPLES; i += 1) {
      const o = o0 + ((o1 - o0) * i) / (CAP_SAMPLES - 1);
      place(o, profileAt(ring.upper, o));
    }
    for (let i = CAP_SAMPLES - 1; i >= 0; i -= 1) {
      const o = o0 + ((o1 - o0) * i) / (CAP_SAMPLES - 1);
      place(o, profileAt(ring.lower, o));
    }
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    const base = r * ringSize;
    for (let i = 0; i < ringSize; i += 1) {
      const j = (i + 1) % ringSize;
      indices.push(
        base + i,
        base + i + ringSize,
        base + j,
        base + j,
        base + i + ringSize,
        base + j + ringSize
      );
    }
  }
  for (const ringIndex of [0, rings.length - 1]) {
    const base = ringIndex * ringSize;
    const flip = ringIndex !== 0;
    for (let i = 0; i < CAP_SAMPLES - 1; i += 1) {
      const a = base + i;
      const b = base + i + 1;
      const c = base + ringSize - 1 - i;
      const d = base + ringSize - 2 - i;
      if (flip) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Superficie resultante de una etapa: es la que recubren los geosinteticos. */
export function buildPhaseSurface(vaso, phase, site, lift = 0.08, cumulative = false) {
  const sampler = alignmentSampler(vaso.eje);
  const rings = phaseRings(vaso, phase, cumulative);
  if (rings.length < 2) return null;

  const positions = [];
  const uvs = [];
  const indices = [];
  for (const ring of rings) {
    const a = sampler(ring.station);
    const [o0, o1] = ring.span;
    for (let i = 0; i < CAP_SAMPLES; i += 1) {
      const o = o0 + ((o1 - o0) * i) / (CAP_SAMPLES - 1);
      positions.push(
        site.x(a.east + a.rightE * o),
        site.y(profileAt(ring.upper, o)) + lift,
        site.z(a.north + a.rightN * o)
      );
      uvs.push((ring.station % 70) / 70, (o - o0) / Math.max(o1 - o0, 1));
    }
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < CAP_SAMPLES - 1; i += 1) {
      const a = r * CAP_SAMPLES + i;
      indices.push(a, a + CAP_SAMPLES, a + 1, a + 1, a + CAP_SAMPLES, a + CAP_SAMPLES + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildOperationCover(vaso, phase, site, baseColor) {
  const sampler = alignmentSampler(vaso.eje);
  const rings = phaseRings(vaso, phase);
  if (rings.length < 2) return null;
  const group = new THREE.Group();

  const coverGeometry = buildPhaseSurface(vaso, phase, site, 0.18);
  if (coverGeometry) {
    const coverColor = new THREE.Color(baseColor).lerp(new THREE.Color(0xd3b579), 0.62);
    const cover = new THREE.Mesh(
      coverGeometry,
      new THREE.MeshStandardMaterial({
        color: coverColor,
        map: COVER_TEXTURE,
        roughness: 0.94,
        metalness: 0,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    cover.name = "cobertura-operacion";
    cover.userData.pickable = "Masa de residuos compactada y cubierta sobre la rasante de etapa";
    group.add(cover);
    group.userData.cover = cover;
  }

  const bandPositions = [];
  const liftOffsets = [];
  const bandColor = new THREE.Color(0x6d573f);
  const place = (ring, offset, lift = 0.28) => {
    const a = sampler(ring.station);
    return new THREE.Vector3(
      site.x(a.east + a.rightE * offset),
      site.y(profileAt(ring.upper, offset)) + lift,
      site.z(a.north + a.rightN * offset)
    );
  };
  const ringStep = Math.max(1, Math.floor(rings.length / 9));
  for (let r = 0; r < rings.length; r += ringStep) {
    const ring = rings[r];
    const [o0, o1] = ring.span;
    let prev = null;
    for (let i = 0; i < CAP_SAMPLES; i += 4) {
      const o = o0 + ((o1 - o0) * i) / (CAP_SAMPLES - 1);
      const p = place(ring, o, 0.34 + (r % 2) * 0.08);
      if (prev) bandPositions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
    }
  }
  for (const fraction of [0.22, 0.42, 0.62, 0.82]) {
    let prev = null;
    for (const ring of rings) {
      const o = ring.span[0] + (ring.span[1] - ring.span[0]) * fraction;
      const p = place(ring, o, 0.42 + fraction * 0.12);
      if (prev) bandPositions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
    }
  }
  const bandGeometry = new THREE.BufferGeometry();
  bandGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bandPositions, 3));
  const bands = new THREE.LineSegments(
    bandGeometry,
    new THREE.LineBasicMaterial({
      color: bandColor,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    })
  );
  bands.name = "bandas-compactacion";
  group.add(bands);

  const frontPositions = [];
  const frontRing = rings[rings.length - 1];
  const [o0, o1] = frontRing.span;
  let prev = null;
  for (let i = 0; i < CAP_SAMPLES; i += 2) {
    const o = o0 + ((o1 - o0) * i) / (CAP_SAMPLES - 1);
    const p = place(frontRing, o, 0.55);
    if (prev) frontPositions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    prev = p;
  }
  const frontGeometry = new THREE.BufferGeometry();
  frontGeometry.setAttribute("position", new THREE.Float32BufferAttribute(frontPositions, 3));
  const front = new THREE.LineSegments(
    frontGeometry,
    new THREE.LineBasicMaterial({
      color: 0xffc857,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
  );
  front.name = "frente-activo";
  front.userData.pickable = "Frente de trabajo activo de la etapa visible";
  group.add(front);
  group.userData.front = front;
  group.userData.setCurrent = (current) => {
    if (group.userData.cover) {
      group.userData.cover.material.opacity = current ? 0.42 : 0.28;
      group.userData.cover.material.needsUpdate = true;
    }
    front.visible = current;
    bands.material.opacity = current ? 0.58 : 0.34;
    bands.material.needsUpdate = true;
  };

  return group;
}

export function buildBasins(model, site) {
  const root = new THREE.Group();
  const byVaso = new Map();
  const byPhase = new Map();

  for (const [vkey, vaso] of Object.entries(model.vasos)) {
    const vasoGroup = new THREE.Group();
    vasoGroup.name = vkey;
    byVaso.set(vkey, vasoGroup);

    for (const phase of vaso.fases) {
      const style = PHASE_STYLE[phase] || { color: 0x8a8a8a, label: phase };
      const phaseGroup = new THREE.Group();
      phaseGroup.name = phase;
      phaseGroup.userData = { vaso: vkey, phase, label: style.label };

      const body = buildPhaseBody(vaso, phase, site, style.color);
      if (body) {
        const mesh = new THREE.Mesh(
          body,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            map: WASTE_TEXTURE,
            roughness: 0.7,
            metalness: 0.02,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 1,
            flatShading: false,
          })
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.pickable = style.label;
        phaseGroup.add(mesh);
        phaseGroup.userData.mesh = mesh;
      }

      const operation = buildOperationCover(vaso, phase, site, style.color);
      if (operation) {
        operation.visible = true;
        phaseGroup.add(operation);
        phaseGroup.userData.operation = operation;
      }

      const rasanteGeometry = buildPhaseSurface(vaso, phase, site, 0, true);
      if (rasanteGeometry) {
        const colors = [];
        for (const ring of phaseRings(vaso, phase, true)) {
          for (let i = 0; i < CAP_SAMPLES; i += 1) {
            const o = ring.span[0] + (ring.span[1] - ring.span[0]) * i / (CAP_SAMPLES - 1);
            const c = earthColor(style.color, profileAt(ring.upper, o) > profileAt(ring.lower, o));
            colors.push(c.r, c.g, c.b);
          }
        }
        rasanteGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        const rasante = new THREE.Mesh(rasanteGeometry, new THREE.MeshStandardMaterial({
          color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0, side: THREE.DoubleSide,
        }));
        rasante.userData.pickable = `${style.label} | superficie de proyecto segun secciones`;
        rasante.receiveShadow = true;
        phaseGroup.add(rasante);
        phaseGroup.userData.rasante = rasante;
      }

      // dique o jarillon: el lleno de la etapa, resaltado aparte
      // El jarillon pertenece a la obra inicial; los llenos posteriores no
      // son nuevos diques y no deben pintarse como estructuras de contencion.
      const dike = phase === vaso.fases[0] ? buildDikeBody(vaso, phase, site) : null;
      if (dike) {
        const mesh = new THREE.Mesh(
          dike,
          new THREE.MeshStandardMaterial({
            color: DIKE_COLOR,
            map: DIKE_TEXTURE,
            roughness: 0.85,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: -1,
          })
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = "dique";
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(dike, 48),
          new THREE.LineBasicMaterial({color:PALETTE.edge,transparent:true,opacity:0.45}));
        mesh.add(edges);
        mesh.visible = false;
        const h = dike.userData.maxHeight;
        mesh.userData.pickable =
          `Dique (jarillon) · ${style.label} · altura maxima ${h.toFixed(1)} m`;
        phaseGroup.add(mesh);
        phaseGroup.userData.dike = mesh;
      }

      vasoGroup.add(phaseGroup);
      byPhase.set(phase, phaseGroup);
    }

    root.add(vasoGroup);
  }

  root.userData = { byVaso, byPhase };
  return root;
}

/** Eje de replanteo colgado sobre el terreno. */
export function buildAlignments(model, site) {
  const group = new THREE.Group();
  for (const [vkey, vaso] of Object.entries(model.vasos)) {
    const pts = [];
    for (const [east, north] of vaso.eje.pts) {
      const z = site.elevationAt(east, north);
      pts.push(
        new THREE.Vector3(site.x(east), site.y(z === null ? site.minZ : z) + 1.5, site.z(north))
      );
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.9 })
    );
    line.name = vkey;
    group.add(line);
  }
  return group;
}

/**
 * Huella en planta de la zona intervenida de un vaso: el corredor que cubren
 * todas sus etapas. Sirve para recortar el terreno natural, porque ahi la
 * superficie del proyecto sustituye a la del levantamiento.
 */
export function basinFootprint(vaso, margin = 0) {
  const sampler = alignmentSampler(vaso.eje);
  const left = [];
  const right = [];
  for (const section of vaso.secciones) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const phase of vaso.fases) {
      const upper = section.surfaces && section.surfaces[phase];
      if (!upper) continue;
      const lower = lowerProfile(section, vaso.fases, phase);
      if (!lower) continue;
      const span = activeSpan(upper, lower);
      if (!span) continue;
      lo = Math.min(lo, span[0]);
      hi = Math.max(hi, span[1]);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const a = sampler(section.station);
    left.push([a.east + a.rightE * (lo - margin), a.north + a.rightN * (lo - margin)]);
    right.push([a.east + a.rightE * (hi + margin), a.north + a.rightN * (hi + margin)]);
  }
  if (left.length < 2) return null;
  return left.concat(right.reverse());
}

export function allFootprints(model, margin = 0) {
  const out = [];
  for (const vaso of Object.values(model.vasos)) {
    const poly = basinFootprint(vaso, margin);
    if (poly) out.push(poly);
  }
  return out;
}

/** Punto dentro de poligono, por conteo de cruces. */
export function pointInPolygon(east, north, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > north !== yj > north) {
      const x = xi + ((north - yi) * (xj - xi)) / (yj - yi);
      if (east < x) inside = !inside;
    }
  }
  return inside;
}
