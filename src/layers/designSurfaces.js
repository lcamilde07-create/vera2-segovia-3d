import * as THREE from "three";
import { buildPhaseSurface, PHASE_STYLE } from "./basins.js";

/**
 * Superficies de proyecto deducidas de curvas de nivel rotuladas.
 *
 * A diferencia del plano de topografia, estos planos si rotulan la cota de
 * sus curvas, asi que la superficie sale directamente del dibujo.
 */
export function buildDesignSurfaces(surfaces, site, model) {
  const root = new THREE.Group();
  const byKey = new Map();

  for (const [key, spec] of Object.entries(surfaces)) {
    // Las curvas de instrumentacion no delimitan el volumen de disposicion.
    // El estado final se toma de la ultima rasante documentada de cada vaso.
    if (key === "llenadoFinal") continue;
    const group = new THREE.Group();
    group.name = key;
    group.userData = { label: spec.title, note: spec.note, plan: spec.plan };
    group.visible = false;

    const mesh = gridMesh(spec, site);
    if (mesh) group.add(mesh);

    const lines = contourLines(spec, site);
    if (lines) group.add(lines);

    if (group.children.length) {
      root.add(group);
      byKey.set(key, group);
    }
  }

  const final = new THREE.Group();
  final.name = "llenadoFinal";
  final.visible = false;
  for (const [vaso, definition] of Object.entries(model.vasos)) {
    const phase = definition.fases.at(-1);
    const geometry = buildPhaseSurface(definition, phase, site, 0, true);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: PHASE_STYLE[phase].color, roughness: 0.96, metalness: 0,
      side: THREE.DoubleSide,
    }));
    mesh.receiveShadow = true;
    mesh.userData = { vaso, phase,
      pickable: `${PHASE_STYLE[phase].label} | rasante final segun secciones`,
      visualNote: "Ultima etapa documentada del vaso. Superficie proyectada, no volumen adicional ni relleno fuera del vaso.",
    };
    final.add(mesh);
  }
  root.add(final);
  byKey.set("llenadoFinal", final);
  root.userData = { byKey };
  return root;
}

function gridMesh(spec, site) {
  const g = spec.grid;
  const positions = [];
  const indices = [];
  const index = new Int32Array(g.nx * g.ny).fill(-1);

  for (let iy = 0; iy < g.ny; iy += 1) {
    for (let ix = 0; ix < g.nx; ix += 1) {
      const z = g.z[iy * g.nx + ix];
      if (z === null) continue;
      index[iy * g.nx + ix] = positions.length / 3;
      positions.push(
        site.x(g.east0 + ix * g.step),
        site.y(z),
        site.z(g.north0 + iy * g.step)
      );
    }
  }
  for (let iy = 0; iy < g.ny - 1; iy += 1) {
    for (let ix = 0; ix < g.nx - 1; ix += 1) {
      const a = index[iy * g.nx + ix];
      const b = index[iy * g.nx + ix + 1];
      const c = index[(iy + 1) * g.nx + ix];
      const d = index[(iy + 1) * g.nx + ix + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (!indices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.color),
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.86,
    })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pickable = spec.title;
  return mesh;
}

function contourLines(spec, site) {
  const positions = [];
  for (const c of spec.contours) {
    const y = site.y(c.z) + 0.35;
    for (let i = 0; i < c.pts.length - 1; i += 1) {
      positions.push(
        site.x(c.pts[i][0]), y, site.z(c.pts[i][1]),
        site.x(c.pts[i + 1][0]), y, site.z(c.pts[i + 1][1])
      );
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x101a1e,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
  );
}
