import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

/**
 * Malla del vuelo de dron, situada sobre el modelo del proyecto.
 *
 * El vuelo viene en UTM 18N y el proyecto en MAGNA-SIRGAS origen Bogota. Sobre
 * la extension del vuelo la conversion entre ambos es una semejanza plana, asi
 * que se aplica como una matriz al nodo y no hay que tocar los vertices: la
 * malla trae cientos de miles y conviene no recorrerlos.
 *
 * Los vertices del GLB son relativos al centro RTC que declara el propio
 * archivo, que es justo el origen sobre el que se ajusto la semejanza.
 */
export async function buildDrone(config, site, onProgress) {
  const group = new THREE.Group();
  group.visible = false;
  if (!config || !config.archivo) return Object.assign(group, { userData: { missing: true } });

  const draco = new DRACOLoader();
  draco.setDecoderPath("vendor/three/examples/jsm/libs/draco/gltf/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync(config.archivo, (event) => {
    if (onProgress && event.total) onProgress(event.loaded / event.total);
  });
  draco.dispose();

  const model = gltf.scene;
  model.applyMatrix4(placementMatrix(config, site));

  model.traverse((node) => {
    if (!node.isMesh) return;
    node.userData.pickable = `Vuelo de dron ${config.vuelo || ""}`.trim();
    node.renderOrder = 1;
    const originalMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const converted = originalMaterials.map((material) => {
      if (!material || !material.isMeshBasicMaterial) return material;
      return new THREE.MeshStandardMaterial({
        map: material.map || null,
        color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
        roughness: 0.88,
        metalness: 0,
        vertexColors: material.vertexColors,
      });
    });
    node.material = Array.isArray(node.material) ? converted : converted[0];
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      // la malla invierte el sentido de giro al pasar a coordenadas de escena
      material.side = THREE.DoubleSide;
      material.transparent = true;
      material.depthWrite = true;
    }
  });

  group.add(model);
  group.userData = {
    model,
    config,
    setOpacity(value) {
      model.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (!material) continue;
          material.opacity = value;
          material.transparent = value < 1;
        }
      });
    },
  };
  return group;
}

/**
 * Matriz que lleva un vertice del GLB a coordenadas de escena.
 *
 *   E =  a*gx + b*gy + tx          x = E - east0
 *   N = -b*gx + a*gy + ty          z = -(N - north0)
 *   cota = gz + desfase            y = (cota - base) * exageracion
 */
export function placementMatrix(config, site) {
  const { a, b, tx, ty } = config.afin;
  const dz = config.desfaseVertical || 0;
  const k = site.exaggeration;

  const m = new THREE.Matrix4();
  m.set(
    a, b, 0, tx - site.east0,
    0, 0, k, k * (dz - site.base),
    b, -a, 0, site.north0 - ty,
    0, 0, 0, 1
  );
  return m;
}

/**
 * Muestreador del suelo del levantamiento de dron.
 *
 * El vuelo es la superficie ACTUAL del sitio; el resto del modelo se cuelga
 * del terreno de los planos. Donde el sitio ya cambio, lo que se drapea sobre
 * el terreno del plano queda flotando o enterrado respecto a la malla del
 * dron. Este muestreador devuelve la cota del vuelo tal como se dibuja (con
 * su desfase vertical ya aplicado), para poder posar los elementos encima.
 *
 * Se queda con la cota MINIMA por celda, que aproxima el suelo bajo la
 * vegetacion (mismo truco que measureVerticalOffset), y al leer promedia la
 * vecindad 3x3 para suavizar el diente de la malla.
 */
export function buildGroundSampler(droneGroup, site, cell = 2.5) {
  const lowest = new Map();
  const point = new THREE.Vector3();

  droneGroup.traverse((node) => {
    if (!node.isMesh) return;
    node.updateWorldMatrix(true, false);
    const pos = node.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) {
      point.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(node.matrixWorld);
      const east = site.east0 + point.x;
      const north = site.north0 - point.z;
      // cota tal como se dibuja: SIN quitar el desfase, que aqui interesa
      const z = site.base + point.y / site.exaggeration;
      const key = `${Math.round(east / cell)}_${Math.round(north / cell)}`;
      const current = lowest.get(key);
      if (current === undefined || z < current) lowest.set(key, z);
    }
  });

  return (east, north) => {
    const cx = Math.round(east / cell);
    const cy = Math.round(north / cell);
    let sum = 0;
    let n = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const z = lowest.get(`${cx + dx}_${cy + dy}`);
        if (z !== undefined) {
          sum += z;
          n += 1;
        }
      }
    }
    // se exige algo de vecindad: una celda suelta en el borde del vuelo no
    // es suelo fiable
    return n >= 3 ? sum / n : null;
  };
}

/**
 * Mide el desfase altimetrico del vuelo contra el terreno del proyecto.
 *
 * Se queda con la cota minima del vuelo en celdas pequenas, que aproxima el
 * suelo bajo la vegetacion, y la compara con el MDT solo donde este viene de
 * curvas de nivel. Devuelve la moda y la mediana; la segunda restringida a las
 * celdas que caen sobre via del levantamiento, que es suelo desnudo.
 *
 * Es la comprobacion de `desfaseVertical` en data/dron.json: se ejecuta desde
 * la consola con `window.visor.medirDesfaseDron()`.
 */
export function measureVerticalOffset(droneGroup, site, terrain, planimetry, cell = 4) {
  const grid = terrain.grid;
  const lowest = new Map();
  const point = new THREE.Vector3();

  droneGroup.traverse((node) => {
    if (!node.isMesh) return;
    node.updateWorldMatrix(true, false);
    const pos = node.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) {
      point.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(node.matrixWorld);
      const east = site.east0 + point.x;
      const north = site.north0 - point.z;
      const z = site.base + point.y / site.exaggeration - (droneGroup.userData.config.desfaseVertical || 0);
      const key = `${Math.round(east / cell)}_${Math.round(north / cell)}`;
      const current = lowest.get(key);
      if (!current || z < current.z) lowest.set(key, { east, north, z });
    }
  });

  const sample = (east, north) => {
    const fx = (east - grid.east0) / grid.step;
    const fy = (north - grid.north0) / grid.step;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= grid.nx - 1 || iy >= grid.ny - 1) return null;
    if (grid.interpolated && (grid.interpolated[iy * grid.nx + ix] || grid.interpolated[(iy + 1) * grid.nx + ix + 1])) {
      return null;
    }
    const a = grid.z[iy * grid.nx + ix];
    const b = grid.z[iy * grid.nx + ix + 1];
    const c = grid.z[(iy + 1) * grid.nx + ix];
    const d = grid.z[(iy + 1) * grid.nx + ix + 1];
    if (a === null || b === null || c === null || d === null) return null;
    const tx = fx - ix;
    const ty = fy - iy;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };

  const roads = [];
  for (const line of (planimetry.vias && planimetry.vias.lines) || []) roads.push(...line);
  const onRoad = (east, north) =>
    roads.some(([e, n]) => Math.abs(e - east) < 4 && Math.abs(n - north) < 4);

  const all = [];
  const road = [];
  for (const { east, north, z } of lowest.values()) {
    const ground = sample(east, north);
    if (ground === null) continue;
    all.push(z - ground);
    if (onRoad(east, north)) road.push(z - ground);
  }

  const mode = (values, width = 0.5) => {
    const bins = new Map();
    for (const v of values) {
      const k = Math.floor(v / width) * width;
      bins.set(k, (bins.get(k) || 0) + 1);
    }
    const best = [...bins.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  };
  const median = (values) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  return {
    celdas: lowest.size,
    comparables: all.length,
    moda: mode(all),
    mediana: median(all),
    enVia: road.length,
    medianaEnVia: median(road),
  };
}
