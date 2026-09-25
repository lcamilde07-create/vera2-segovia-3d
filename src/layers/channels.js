import * as THREE from "three";
import { PALETTE } from "../core/palette.js";

// Seccion minima del detalle de aguas lluvias del vaso 2. El talud lateral
// no tiene cota: su apertura es esquematica y se declara en la interfaz.
export const CHANNEL_NOTE = "Canal proyectado: fondo 0,50 m y profundidad 0,50 m, segun detalle del vaso 2. Apertura lateral esquematica, sin talud acotado. Seccion elevada 0,54 m para mostrarla sobre la superficie sin modificar el MDT; no es cota de obra. Cunetas existentes: solo traza, sin seccion constructiva verificada. Textura ilustrativa; no representa un levantamiento de materiales.";

export function buildOpenChannel(line, sampler, site) {
  const runs = [];
  let points = [];
  // El muestreo sigue cada segmento recto del plano, sin redondear sus giros.
  const flush = () => { if (points.length > 1) runs.push(points); points = []; };
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i], b = line[i + 1];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.75));
    for (let j = 0; j < count; j += 1) {
      const f = j / count;
      const e = a[0] + (b[0] - a[0]) * f, n = a[1] + (b[1] - a[1]) * f;
      const z = sampler(e, n);
      if (z === null) { flush(); continue; }
      const p = new THREE.Vector3(site.x(e), site.y(z), site.z(n));
      if (!points.length || p.distanceTo(points[points.length - 1]) > 0.001) points.push(p);
    }
  }
  const last = line[line.length - 1];
  if (last) {
    const z = sampler(...last);
    if (z !== null) points.push(new THREE.Vector3(site.x(last[0]), site.y(z), site.z(last[1])));
  }
  flush();
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: PALETTE.channel, roughness: 1, side: THREE.DoubleSide });
  // Grano de sombreado: aporta material sin desplazar vertices ni alterar cotas.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 suelo;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nsuelo = position;");
    shader.fragmentShader = "varying vec3 suelo;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      float grano = fract(sin(dot(floor(suelo * 35.0), vec3(12.9898,78.233,39.425))) * 43758.5453);
      diffuseColor.rgb *= 0.84 + 0.25 * grano;`);
  };
  const profile = [[-0.40, 0.54], [-0.25, 0.04], [0.25, 0.04], [0.40, 0.54]];
  for (const run of runs) {
    const pos = [], uv = [], colors = [], indices = [];
    let length = 0;
    for (let i = 0; i < run.length; i += 1) {
      const p = run[i];
      if (i) length += p.distanceTo(run[i - 1]);
      const direction = run[Math.min(i + 1, run.length - 1)].clone().sub(run[Math.max(0, i - 1)]).setY(0).normalize();
      const right = new THREE.Vector3(direction.z, 0, -direction.x);
      for (let k = 0; k < profile.length; k += 1) {
        const [w, h] = profile[k];
        const v = p.clone().addScaledVector(right, w);
        pos.push(v.x, v.y + h * site.exaggeration, v.z);
        uv.push(length, k / 3);
        const shade = k === 1 || k === 2 ? 0.59 : 1;
        colors.push(shade, shade, shade);
      }
      if (i) for (let k = 0; k < 3; k += 1) {
        const a = (i - 1) * 4 + k, b = i * 4 + k;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    material.vertexColors = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.userData.pickable = "Canal abierto de aguas lluvias | fondo 0,50 m; profundidad 0,50 m | alzado esquematico +0,54 m";
    group.add(mesh);
  }
  group.userData.inspectionPoints = runs.flat();
  return group;
}
