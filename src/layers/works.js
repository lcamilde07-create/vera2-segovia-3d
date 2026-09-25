import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PALETTE } from "../core/palette.js";

function gravelTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#9a9284";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 1400; i += 1) {
    const v = 90 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v},${v * 0.96},${v * 0.84},${0.18 + Math.random() * 0.22})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 3);
  texture.anisotropy = 8;
  return texture;
}

const ROAD_TEXTURE = gravelTexture();

const STYLE = {
  viaPrincipal: { width: 5.2, lift: 0.22, color: 0xb5afa2, kind: "ribbon" },
  viaOficinas: { width: 4.2, lift: 0.22, color: 0xb5afa2, kind: "ribbon" },
  proyeccionOficinas: { width: 3.2, lift: 0.18, color: 0x9ea7aa, kind: "ribbon", opacity: 0.55 },
  proyeccionPtlix: { width: 3.2, lift: 0.18, color: 0x9ea7aa, kind: "ribbon", opacity: 0.55 },
  areaMineria: { width: 4.0, lift: 0.2, color: 0x8e8271, kind: "ribbon", opacity: 0.62 },
  alcantarillas: { radius: 0.28, lift: 0.25, color: 0x57d5db, kind: "tube" },
  pisoDuro: { width: 3.6, lift: 0.2, color: 0x8a8f8f, kind: "ribbon" },
  hombros: { radius: 0.22, lift: 0.3, color: 0xb08968, kind: "tube" },
  patas: { radius: 0.22, lift: 0.3, color: 0x8f6b4f, kind: "tube" },
};

function pointsFromLine(line, drape, site, lift) {
  const points = [];
  for (const [east, north] of line) {
    const z = drape(east, north);
    if (z === null) continue;
    const p = new THREE.Vector3(site.x(east), site.y(z) + lift, site.z(north));
    if (!points.length || p.distanceTo(points[points.length - 1]) > 0.05) points.push(p);
  }
  return points.length >= 2 ? points : null;
}

function tangentAt(points, i) {
  const prev = points[Math.max(0, i - 1)];
  const next = points[Math.min(points.length - 1, i + 1)];
  const tangent = next.clone().sub(prev).setY(0);
  if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
  return tangent.normalize();
}

function ribbonGeometry(points, width) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) distance += points[i].distanceTo(points[i - 1]);
    const t = tangentAt(points, i);
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    const left = points[i].clone().addScaledVector(right, -width / 2);
    const r = points[i].clone().addScaledVector(right, width / 2);
    positions.push(left.x, left.y, left.z, r.x, r.y, r.z);
    uvs.push(0, distance / 12, 1, distance / 12);
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function edgesForRibbon(points, width, color) {
  const positions = [];
  for (const side of [-1, 1]) {
    let prev = null;
    for (let i = 0; i < points.length; i += 1) {
      const t = tangentAt(points, i);
      const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
      const p = points[i].clone().addScaledVector(right, (width / 2) * side).setY(points[i].y + 0.04);
      if (prev) positions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false })
  );
}

function makeLine(layer, site, drape, lift = 0.9) {
  const positions = [];
  for (const line of layer.lines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const z0 = drape(line[i][0], line[i][1]);
      const z1 = drape(line[i + 1][0], line[i + 1][1]);
      if (z0 === null || z1 === null) continue;
      positions.push(
        site.x(line[i][0]), site.y(z0) + lift, site.z(line[i][1]),
        site.x(line[i + 1][0]), site.y(z1) + lift, site.z(line[i + 1][1])
      );
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: new THREE.Color(layer.color),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    })
  );
}

/**
 * Obras y accesos: corredores viales, area de mineria y proyecciones de zona.
 * Son trazados en planta, asi que se cuelgan sobre la superficie del terreno.
 */
export function buildWorks(model, site, drape) {
  const root = new THREE.Group();
  const byKey = new Map();
  if (!model.obras) return Object.assign(root, { userData: { byKey } });

  for (const [key, layer] of Object.entries(model.obras)) {
    const style = STYLE[key] ? { ...STYLE[key], color: key === "alcantarillas" ? PALETTE.concrete
      : ["hombros","patas"].includes(key) ? PALETTE.dike : PALETTE.road } : null;
    const group = new THREE.Group();
    group.name = key;
    group.userData = { label: layer.label, color: layer.color };

    if (style && style.kind === "ribbon") {
      const material = new THREE.MeshStandardMaterial({
        color: style.color,
        map: ROAD_TEXTURE,
        roughness: 0.88,
        metalness: 0,
        transparent: style.opacity !== undefined,
        opacity: style.opacity ?? 1,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -0.6,
      });
      for (const line of layer.lines) {
        const points = pointsFromLine(line, drape, site, style.lift);
        if (!points) continue;
        // Un contorno cerrado documenta superficie; un fragmento no documenta ancho.
        const closed = line.length > 3 && Math.hypot(line[0][0]-line.at(-1)[0],line[0][1]-line.at(-1)[1]) < 1e-6;
        if (!closed) {
          const segments = points.slice(1).flatMap((p,i)=>[points[i],p]);
          const trace = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments),
            new THREE.LineBasicMaterial({color:PALETTE.road}));
          trace.userData.pickable = `${layer.label} · traza sin ancho documentado`;
          group.add(trace);
          continue;
        }
        const contour = points.slice(0,-1);
        const geometry = new THREE.BufferGeometry().setFromPoints(contour);
        geometry.setIndex(THREE.ShapeUtils.triangulateShape(contour.map(p=>new THREE.Vector2(p.x,p.z)),[]).flat());
        geometry.setAttribute("uv",new THREE.Float32BufferAttribute(contour.flatMap(p=>[p.x/20,p.z/20]),2));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.pickable = `${layer.label} · contorno cerrado del plano`;
        group.add(mesh);
      }
    } else if (style && style.kind === "tube") {
      const material = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: 0.72,
        metalness: 0.05,
      });
      for (const line of layer.lines) {
        const points = pointsFromLine(line, drape, site, style.lift);
        if (!points) continue;
        const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.2);
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.min(240, points.length * 3), style.radius, 10, false),
          material
        );
        mesh.castShadow = true;
        mesh.userData.pickable = key === "alcantarillas"
          ? `${layer.label} | traza del plano; diametro grafico 0,56 m, no cota verificada`
          : layer.label;
        group.add(mesh);
      }
    } else {
      const lines = makeLine(layer, site, drape);
      if (lines) { lines.userData.pickable=layer.label; group.add(lines); }
    }

    if (!group.children.length) continue;
    // Los corredores traen cientos de fragmentos CAD. Agrupar los que tienen
    // el mismo material conserva sus vertices y evita miles de llamadas de dibujo.
    // Las alcantarillas permanecen separadas para seleccionarlas por tramo.
    if (key !== "alcantarillas" && group.children.length > 32) {
      for (const kind of ["isMesh", "isLineSegments"]) {
        const objects = group.children.filter(object => object[kind]);
        if (objects.length < 2) continue;
        const geometry = mergeGeometries(objects.map(object => object.geometry), false);
        if (!geometry) continue;
        const material = objects[0].material;
        const merged = kind === "isMesh" ? new THREE.Mesh(geometry, material) : new THREE.LineSegments(geometry, material);
        merged.castShadow = objects[0].castShadow;
        merged.receiveShadow = objects[0].receiveShadow;
        merged.userData = { ...objects[0].userData, fragmentos: objects.length };
        for (const object of objects) { group.remove(object); object.geometry.dispose(); }
        for (const extra of new Set(objects.map(object => object.material))) if (extra !== material) extra.dispose();
        group.add(merged);
      }
    }
    root.add(group);
    byKey.set(key, group);
  }
  root.userData = { byKey };
  return root;
}

/** Piezometros de la instrumentacion geotecnica. */
export function buildPiezometers(model, site, drape) {
  const group = new THREE.Group();
  const list = (model.puntos && model.puntos.piezometros) || [];
  let skippedOutsideTerrain = 0;
  const material = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0x6b2f06,
    roughness: 0.45,
  });
  for (const p of list) {
    if (site.elevationAt(p.east, p.north) === null) {
      skippedOutsideTerrain += 1;
      continue;
    }
    const z = drape(p.east, p.north);
    if (z === null) continue;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 10), material);
    mesh.position.set(site.x(p.east), site.y(z) + 3, site.z(p.north));
    mesh.castShadow = true;
    mesh.userData.pickable = `Piezometro · E ${p.east.toFixed(1)} / N ${p.north.toFixed(1)}`;
    group.add(mesh);
  }
  group.userData.total = list.length;
  group.userData.skippedOutsideTerrain = skippedOutsideTerrain;
  return group;
}
