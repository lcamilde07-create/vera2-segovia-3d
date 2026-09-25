import * as THREE from "three";
import { PALETTE } from "../core/palette.js";

/** Rampa hipsometrica: verde en las vaguadas, ocre y gris en las cotas altas. */
const RAMP = PALETTE.terrainRamp;

function terrainTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      // Grano isotropo: las ondas anteriores parecian surcos topograficos.
      const n = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 13;
      const base = 224 + n;
      image.data[i] = base * 0.98;
      image.data[i + 1] = base;
      image.data[i + 2] = base * 0.92;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 7);
  texture.anisotropy = 8;
  return texture;
}

function rampColor(t) {
  for (let i = 1; i < RAMP.length; i += 1) {
    if (t <= RAMP[i][0] || i === RAMP.length - 1) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      const a = new THREE.Color(c0);
      const b = new THREE.Color(c1);
      return a.lerp(b, Math.max(0, Math.min(1, k)));
    }
  }
  return new THREE.Color(RAMP[RAMP.length - 1][1]);
}

/**
 * Malla del terreno natural a partir del MDT deducido de las curvas de nivel.
 * Las celdas sin dato (el relleno existente, que el plano dibuja sin curvas)
 * se omiten para no inventar superficie.
 */
export function buildTerrain(terrain, site, holes = [], isInside = null) {
  const g = terrain.grid;
  const group = new THREE.Group();

  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const index = new Int32Array(g.nx * g.ny).fill(-1);

  for (let iy = 0; iy < g.ny; iy += 1) {
    for (let ix = 0; ix < g.nx; ix += 1) {
      const z = g.z[iy * g.nx + ix];
      if (z === null) continue;
      const east = g.east0 + ix * g.step;
      const north = g.north0 + iy * g.step;
      // el terreno natural no se dibuja donde el proyecto lo excava
      if (isInside && holes.some((poly) => isInside(east, north, poly))) continue;
      index[iy * g.nx + ix] = positions.length / 3;
      positions.push(site.x(east), site.y(z), site.z(north));
      uvs.push((east - g.east0) / Math.max(g.nx * g.step, 1), (north - g.north0) / Math.max(g.ny * g.step, 1));
      const t = (z - site.minZ) / Math.max(site.maxZ - site.minZ, 1);
      const c = rampColor(t);
      // donde el plano no dibuja curvas la superficie es una interpolacion:
      // se desatura y se oscurece para que se distinga de la topografia
      // levantada. Con un gris claro salia siendo lo mas brillante de la
      // escena, que es justo al reves de lo que interesa: el dato menos
      // seguro no debe llevarse la mirada.
      if (g.interpolated && g.interpolated[iy * g.nx + ix]) {
        c.lerp(new THREE.Color(PALETTE.interpolated), 0.86);
      }
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let iy = 0; iy < g.ny - 1; iy += 1) {
    for (let ix = 0; ix < g.nx - 1; ix += 1) {
      const a = index[iy * g.nx + ix];
      const b = index[iy * g.nx + ix + 1];
      const c = index[(iy + 1) * g.nx + ix];
      const d = index[(iy + 1) * g.nx + ix + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      // el norte crece hacia -Z, asi que este es el orden que deja la normal arriba
      indices.push(a, b, c, b, d, c);
    }
  }

  // Faldon en el borde del recorte: sin el, entre el terreno y el cuerpo de la
  // obra se verian los escalones de la malla recortados contra el fondo.
  // El bloque se apoya en una base horizontal, como una maqueta: con el faldon
  // colgando una profundidad fija de cada vertice, la silueta inferior copiaba
  // los dientes de la malla y se veia como un serrucho.
  const BASE_MARGIN = 24;
  const baseY = site.y(site.minZ) - BASE_MARGIN;
  const wallTop = new THREE.Color(PALETTE.skirtTop);
  const wallBottom = new THREE.Color(PALETTE.skirtBottom);

  const quadComplete = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= g.nx - 1 || iy >= g.ny - 1) return false;
    return (
      index[iy * g.nx + ix] >= 0 &&
      index[iy * g.nx + ix + 1] >= 0 &&
      index[(iy + 1) * g.nx + ix] >= 0 &&
      index[(iy + 1) * g.nx + ix + 1] >= 0
    );
  };

  const naturalQuad = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= g.nx - 1 || iy >= g.ny - 1) return false;
    return [iy * g.nx + ix, iy * g.nx + ix + 1,
      (iy + 1) * g.nx + ix, (iy + 1) * g.nx + ix + 1].every(i => g.z[i] !== null);
  };

  // El faldon va en su propia malla y sin iluminar. El borde del recorte es
  // una escalera de celdas, asi que sus caras alternan de orientacion; con luz
  // direccional cada tramo se sombreaba distinto y la pared salia corrugada,
  // como un carton ondulado. Plano y con un degradado vertical se lee como el
  // zocalo de una maqueta, que es lo que representa.
  const sPositions = [];
  const sColors = [];
  const sIndices = [];
  const skirtTop = new Map();
  const skirtBottom = new Map();

  const skirtVertex = (v, store, y, color) => {
    let idx = store.get(v);
    if (idx !== undefined) return idx;
    idx = sPositions.length / 3;
    sPositions.push(positions[v * 3], y === null ? positions[v * 3 + 1] : y, positions[v * 3 + 2]);
    sColors.push(color.r, color.g, color.b);
    store.set(v, idx);
    return idx;
  };

  const addSkirt = (a, b) => {
    const ta = skirtVertex(a, skirtTop, null, wallTop);
    const tb = skirtVertex(b, skirtTop, null, wallTop);
    const ba = skirtVertex(a, skirtBottom, baseY, wallBottom);
    const bb = skirtVertex(b, skirtBottom, baseY, wallBottom);
    sIndices.push(ta, ba, tb, tb, ba, bb);
  };

  for (let iy = 0; iy < g.ny; iy += 1) {
    for (let ix = 0; ix < g.nx; ix += 1) {
      const here = index[iy * g.nx + ix];
      if (here < 0) continue;
      // arista horizontal con el vecino de la derecha
      const right = ix + 1 < g.nx ? index[iy * g.nx + ix + 1] : -1;
      if (right >= 0 && quadComplete(ix, iy) !== quadComplete(ix, iy - 1)) {
        // Solo el contorno exterior lleva zocalo. En una excavacion interior
        // prolongarlo hasta la base inventaba una pared vertical de decenas de metros.
        if (!naturalQuad(ix, iy) || !naturalQuad(ix, iy - 1)) addSkirt(here, right);
      }
      // arista vertical con el vecino de abajo
      const down = iy + 1 < g.ny ? index[(iy + 1) * g.nx + ix] : -1;
      if (down >= 0 && quadComplete(ix, iy) !== quadComplete(ix - 1, iy)) {
        if (!naturalQuad(ix, iy) || !naturalQuad(ix - 1, iy)) addSkirt(here, down);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: terrainTexture(),
    roughness: 0.94,
    metalness: 0,
    // doble cara: en el borde del recorte de los vasos se ve el reverso de la
    // malla, y sin esto quedaria un contorno negro
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData.pickable = "terreno";
  group.add(mesh);
  group.userData.mesh = mesh;

  if (sIndices.length) {
    const skirtGeometry = new THREE.BufferGeometry();
    skirtGeometry.setAttribute("position", new THREE.Float32BufferAttribute(sPositions, 3));
    skirtGeometry.setAttribute("color", new THREE.Float32BufferAttribute(sColors, 3));
    skirtGeometry.setIndex(sIndices);
    const skirt = new THREE.Mesh(
      skirtGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    skirt.userData.pickable = "corte del terreno";
    group.add(skirt);
    group.userData.skirt = skirt;
  }

  if (g.interpolated) {
    const boundary = [];
    const addEdge = (a, b) => {
      if (a < 0 || b < 0) return;
      boundary.push(
        positions[a * 3], positions[a * 3 + 1] + 0.18, positions[a * 3 + 2],
        positions[b * 3], positions[b * 3 + 1] + 0.18, positions[b * 3 + 2]
      );
    };
    for (let iy = 0; iy < g.ny; iy += 1) {
      for (let ix = 0; ix < g.nx; ix += 1) {
        const here = index[iy * g.nx + ix];
        if (here < 0) continue;
        const flag = Boolean(g.interpolated[iy * g.nx + ix]);
        if (ix + 1 < g.nx && flag !== Boolean(g.interpolated[iy * g.nx + ix + 1])) {
          addEdge(here, index[iy * g.nx + ix + 1]);
        }
        if (iy + 1 < g.ny && flag !== Boolean(g.interpolated[(iy + 1) * g.nx + ix])) {
          addEdge(here, index[(iy + 1) * g.nx + ix]);
        }
      }
    }
    if (boundary.length) {
      const boundaryGeometry = new THREE.BufferGeometry();
      boundaryGeometry.setAttribute("position", new THREE.Float32BufferAttribute(boundary, 3));
      const boundaryLine = new THREE.LineSegments(
        boundaryGeometry,
        new THREE.LineBasicMaterial({
          color: 0xd8d0be,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
        })
      );
      boundaryLine.userData.pickable = "limite de zona interpolada sin curvas de nivel";
      group.add(boundaryLine);
      group.userData.interpolatedBoundary = boundaryLine;
    }
  }

  return group;
}

/** Curvas de nivel reales del plano, colgadas sobre el terreno. */
export function buildContours(terrain, site) {
  const group = new THREE.Group();
  const minor = [];
  const major = [];

  for (const c of terrain.contours) {
    const target = c.major ? major : minor;
    const y = site.y(c.z) + (c.major ? 0.45 : 0.3);
    for (let i = 0; i < c.pts.length - 1; i += 1) {
      const [e0, n0] = c.pts[i];
      const [e1, n1] = c.pts[i + 1];
      target.push(site.x(e0), y, site.z(n0), site.x(e1), y, site.z(n1));
    }
  }

  const make = (arr, color, opacity) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    );
  };

  group.add(make(minor, PALETTE.contour, 0.3));
  group.add(make(major, PALETTE.contourMajor, 0.7));
  return group;
}
