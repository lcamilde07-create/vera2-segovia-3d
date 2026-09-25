import * as THREE from "three";

/**
 * Plano tecnico de referencia proyectado sobre el terreno.
 *
 * El raster del PDF se coloca en su sitio real usando la misma
 * georreferenciacion que la geometria vectorial, asi que el dibujo cae
 * exactamente sobre el modelo y se puede contrastar uno contra otro.
 */
export function buildPlanSheet(terrainMesh, site, planos) {
  const group = new THREE.Group();
  group.visible = false;

  const geometry = terrainMesh.geometry.clone();
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  group.add(mesh);

  const loader = new THREE.TextureLoader();
  const cache = new Map();

  /** Recalcula las UV para que la imagen del plano caiga donde corresponde. */
  function applyUv(plan) {
    const g = plan.georreferencia;
    const page = plan.pagina;
    const img = plan.imagen;
    const pxPerPt = img.ancho / page.anchoPt;

    const pos = geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      const east = site.east0 + pos.getX(i);
      const north = site.north0 - pos.getZ(i);
      // mundo -> pt del PDF -> pixel -> uv
      const xPt = g.originX + (east - g.east0) / g.metresPerPoint;
      const yPt = g.originY - (north - g.north0) / g.metresPerPoint;
      uv[i * 2] = (xPt * pxPerPt) / img.ancho;
      uv[i * 2 + 1] = 1 - (yPt * pxPerPt) / img.alto;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
  }

  async function show(planKey) {
    const plan = planos[planKey];
    if (!plan || !plan.imagen) return null;
    if (!cache.has(planKey)) {
      const texture = await loader.loadAsync(plan.imagen.ruta);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 8;
      cache.set(planKey, texture);
    }
    material.map = cache.get(planKey);
    material.needsUpdate = true;
    applyUv(plan);
    return plan;
  }

  group.userData = { show, material };
  return group;
}
