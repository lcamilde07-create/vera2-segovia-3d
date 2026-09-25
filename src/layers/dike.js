import * as THREE from "three";
import { PALETTE } from "../core/palette.js";

/**
 * Jarillon (talud impermeabilizado) de cada vaso.
 *
 * Es el terraplen que cierra el vaso por su lado bajo y retiene los residuos.
 * Se levanta como capa propia, con las medidas que dio el equipo:
 *   - corona de 4 m de ancho, a la cota de coronacion de la primera etapa;
 *   - talud 1:2 (1 vertical : 2 horizontal) hacia AFUERA del vaso, bajando
 *     hasta el terreno natural.
 * No forma parte de las medidas internas del vaso (su pendiente se extiende
 * por fuera) y no lleva chimeneas encima. No modifica el cuerpo de relleno
 * verificado: es una representacion parametrica del terraplen, declarada.
 */
const CROWN = 4;        // m, ancho de corona
const SLOPE = 2;        // talud 1:2 -> 2 m horizontal por cada 1 m vertical
const HEIGHT = 6;       // m, altura del jarillon inicial sobre el fondo del vaso
const SAMPLES = 44;     // muestras a lo ancho de la cresta (mas = mas suave)

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

function unit(ax, ay) {
  const L = Math.hypot(ax, ay) || 1;
  return [ax / L, ay / L];
}

function profileAt(prof, o) {
  const s = [...prof].sort((a, b) => a[0] - b[0]);
  if (o <= s[0][0]) return s[0][1];
  if (o >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 0; i < s.length - 1; i += 1) {
    if (s[i][0] <= o && o <= s[i + 1][0]) {
      const f = (o - s[i][0]) / Math.max(s[i + 1][0] - s[i][0], 1e-9);
      return s[i][1] + (s[i + 1][1] - s[i][1]) * f;
    }
  }
  return s[0][1];
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
    const pts = vaso.eje.pts;
    if (!pts || pts.length < 2) continue;

    // el borde bajo es la seccion de abscisa minima (fondo mas bajo)
    const sec = vaso.secciones.reduce((a, b) => (a.station <= b.station ? a : b));
    const terr = sec.terrain;
    if (!terr) continue;

    // cresta = fondo del valle en ese extremo + 6 m (jarillon inicial), no la
    // coronacion de la etapa: es un terraplen de arranque, no un muro.
    const bandOffsets = terr.map((p) => p[0]).filter((o) => o >= -55 && o <= 55);
    if (!bandOffsets.length) continue;
    const floor = Math.min(...bandOffsets.map((o) => profileAt(terr, o)));
    const corona = floor + HEIGHT;

    // ancho de la cresta = la franja del valle que el jarillon cierra (terreno
    // por debajo de la cresta), acotado a ±55 m para no abarcar la ladera.
    const offsets = bandOffsets.slice().sort((a, b) => a - b);
    const active = offsets.filter((o) => profileAt(terr, o) < corona - 0.3);
    if (active.length < 2) continue;
    const oLo = active[0];
    const oHi = active[active.length - 1];

    const a0 = pts[0];
    const [dx, dy] = unit(pts[1][0] - a0[0], pts[1][1] - a0[1]); // hacia el interior (sube)
    const ox = -dx, oy = -dy;   // hacia afuera (baja, lado que retiene)
    const rx = -dy, ry = dx;    // transversal al eje

    const crest = [], crownOuter = [], toe = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const o = oLo + (oHi - oLo) * (i / (SAMPLES - 1));
      const ex = a0[0] + rx * o, ny = a0[1] + ry * o;   // punto de cresta (EN)
      crest.push([ex, ny, corona]);
      const cox = ex + ox * CROWN, coy = ny + oy * CROWN;
      crownOuter.push([cox, coy, corona]);
      const tz1 = site.elevationAt(cox, coy);
      const groundCrown = tz1 === null ? corona - 15 : tz1;
      const run = Math.max(CROWN, SLOPE * (corona - groundCrown));   // talud 1:2
      const tx = cox + ox * run, ty = coy + oy * run;
      const tz = site.elevationAt(tx, ty);
      toe.push([tx, ty, tz === null ? groundCrown : tz]);
    }

    const positions = [];
    const uvs = [];
    const P = ([e, n, z]) => {
      const x = site.x(e), zz = site.z(n);
      positions.push(x, site.y(z), zz);
      uvs.push(x / 12, zz / 12);
    };
    // corona (cresta -> corona exterior) y talud (corona exterior -> pata)
    for (let i = 0; i < SAMPLES - 1; i += 1) {
      // corona plana
      P(crest[i]); P(crownOuter[i]); P(crest[i + 1]);
      P(crest[i + 1]); P(crownOuter[i]); P(crownOuter[i + 1]);
      // talud externo 1:2
      P(crownOuter[i]); P(toe[i]); P(crownOuter[i + 1]);
      P(crownOuter[i + 1]); P(toe[i]); P(toe[i + 1]);
    }
    // tapas de los extremos (cresta-coronaExterior-pata) para que se lea solido
    for (const i of [0, SAMPLES - 1]) {
      P(crest[i]); P(crownOuter[i]); P(toe[i]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.userData.pickable =
      `Jarillón ${vkey.replace("vaso", "vaso ")} · corona ${corona.toFixed(1)} m, ` +
      `corona 4 m a +6 m del fondo, talud 1:2 hacia afuera`;
    mesh.userData.visualNote =
      "Terraplén de cierre del vaso. Corona 4 m y talud 1:2 según indicación del " +
      "equipo; no es parte de las medidas internas del vaso ni lleva chimeneas encima.";
    root.add(mesh);
  }

  return root;
}
