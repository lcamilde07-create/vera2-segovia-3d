import * as THREE from "three";

// Los anclajes conservan pertenencia al vaso. El texto se proyecta en HTML,
// sin dar a las etiquetas una altura ficticia sobre las obras.
export function buildLabels(model, site, drape) {
  const group = new THREE.Group();
  for (const [key, vaso] of Object.entries(model.vasos)) {
    const mid = vaso.eje.pts[Math.floor(vaso.eje.pts.length / 2)];
    const z = drape(...mid);
    if (z === null) continue;
    const anchor = new THREE.Object3D();
    anchor.position.set(site.x(mid[0]), site.y(z), site.z(mid[1]));
    anchor.userData.vaso = key;
    group.add(anchor);
  }
  return group;
}
