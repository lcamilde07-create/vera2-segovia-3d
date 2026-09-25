import * as THREE from "three";
import { PALETTE } from "../core/palette.js";

/**
 * Box culvert del relleno.
 *
 * La SECCION viene de las laminas "Analisis hidrologico Q. Sin Nombre -
 * Solicitud ocupacion de cauce" (ene-2022): 1.50 x 1.50 m libre, paredes y
 * losas de 0.25 m, filtros de piedra a ambos costados, aletas a 45 grados.
 *
 * La UBICACION que se dibuja la trae data/box-culvert.json:
 * tools/make_box_under_basins.py la genera bajo los vasos 2 y 3 siguiendo su
 * vaguada (ubicacion indicada por el equipo del proyecto), mientras que
 * data/box-culvert-2022.json conserva como registro la ubicacion licenciada
 * en 2022 en la esquina noroccidental, con sus nueve camaras y su perfil.
 * El modulo dibuja la configuracion que se le pase: tramos por puntos de
 * control del invert, camaras si las hay, cabezales con aletas y, solo si el
 * corredor cae fuera del MDT (franja !== false), una franja de terreno
 * tomada del perfil impreso.
 */
const RIBBON_HALF = 15;     // m a cada lado del eje, solo representacion
const FILTER_WIDTH = 0.8;   // m, lectura grafica de la lamina dimensional
const WING_LENGTH = 2.5;    // m, detalle de aletas de entrada y salida

export function buildBoxCulvert(config, site) {
  const group = new THREE.Group();
  if (!config || !config.eje || config.eje.length < 2) {
    return Object.assign(group, { userData: { missing: true } });
  }

  const outer = config.seccion.anchoInterior + 2 * config.seccion.espesorPared;
  const outerH = config.seccion.altoInterior + 2 * config.seccion.espesorLosa;

  // ------------------------------------------------ interpolaciones por abscisa
  const axis = config.eje;
  function at(station) {
    let i = 0;
    while (i < axis.length - 2 && axis[i + 1].station < station) i += 1;
    const a = axis[i];
    const b = axis[i + 1];
    const f = Math.max(0, Math.min(1, (station - a.station) / Math.max(b.station - a.station, 1e-6)));
    const east = a.east + (b.east - a.east) * f;
    const north = a.north + (b.north - a.north) * f;
    let dx = b.east - a.east;
    let dy = b.north - a.north;
    const len = Math.hypot(dx, dy) || 1;
    return { east, north, dx: dx / len, dy: dy / len };
  }

  const terrain = config.perfilTerreno;
  function terrainAt(station) {
    if (station <= terrain[0].station) return terrain[0].z;
    const last = terrain[terrain.length - 1];
    if (station >= last.station) {
      // el perfil impreso termina en 0+480: el ultimo tramo se prolonga con
      // su misma pendiente (representacion, declarada en la advertencia)
      const prev = terrain[terrain.length - 2];
      const slope = (last.z - prev.z) / (last.station - prev.station);
      return last.z + slope * (station - last.station);
    }
    let i = 0;
    while (i < terrain.length - 2 && terrain[i + 1].station < station) i += 1;
    const a = terrain[i];
    const b = terrain[i + 1];
    const f = (station - a.station) / (b.station - a.station);
    return a.z + (b.z - a.z) * f;
  }

  function place(station, offset, z) {
    const p = at(station);
    // perpendicular horizontal al eje
    return new THREE.Vector3(
      site.x(p.east + p.dy * offset),
      site.y(z),
      site.z(p.north + p.dx * offset)
    );
  }

  // ---------------------------------------------------------------- materiales
  const concrete = new THREE.MeshStandardMaterial({
    color: PALETTE.concrete,
    roughness: 0.85,
    metalness: 0.02,
  });
  const chamberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.concrete).lerp(new THREE.Color(0x000000), 0.18),
    roughness: 0.85,
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    color: PALETTE.stone,
    roughness: 0.96,
  });
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: PALETTE.interpolated,
    roughness: 0.95,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const sourceNote =
    `${config.titulo} · seccion ${config.seccion.anchoInterior.toFixed(2)} x ` +
    `${config.seccion.altoInterior.toFixed(2)} m libre, paredes ${config.seccion.espesorPared.toFixed(2)} m · ` +
    `laminas de ocupacion de cauce (ene-2022), georreferenciadas por su grilla`;

  // ------------------------------------------------------------- cuerpo del box
  // tramos rectos entre puntos de control del invert; en las camaras hay dos
  // cotas con la misma abscisa (entrada y salida) y ahi no se teje tramo
  const profile = config.perfilBox;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < profile.length - 1; i += 1) {
    const a = profile[i];
    const b = profile[i + 1];
    if (b.station - a.station < 0.5) continue;
    const start = place(a.station, 0, a.z + outerH / 2);
    const end = place(b.station, 0, b.z + outerH / 2);
    const dir = end.clone().sub(start);
    const length = dir.length();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(outer, outerH, length), concrete);
    mesh.position.copy(start).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    mesh.castShadow = true;
    mesh.userData.pickable =
      `${sourceNote} · tramo ${formatStation(a.station)} a ${formatStation(b.station)}, ` +
      `invert ${a.z.toFixed(2)} a ${b.z.toFixed(2)} m`;
    group.add(mesh);

    // filtros de piedra a ambos costados, como los dibuja la seccion tipo
    for (const side of [-1, 1]) {
      const off = side * (outer / 2 + FILTER_WIDTH / 2);
      const fs = place(a.station, off, a.z + outerH / 2);
      const fe = place(b.station, off, b.z + outerH / 2);
      const fdir = fe.clone().sub(fs);
      const filter = new THREE.Mesh(
        new THREE.BoxGeometry(FILTER_WIDTH, outerH, fdir.length()),
        stoneMat
      );
      filter.position.copy(fs).addScaledVector(fdir, 0.5);
      filter.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fdir.normalize());
      filter.userData.pickable =
        "Filtro lateral del box: piedra a ambos costados (lamina dimensional; ancho de lectura grafica)";
      group.add(filter);
    }
  }

  // -------------------------------------------------------------------- camaras
  for (const chamber of config.camaras || []) {
    const height = Math.max(chamber.terreno - chamber.batea, 1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(outer + 0.2, height, outer + 0.2), chamberMat);
    const base = place(chamber.station, 0, chamber.batea);
    mesh.position.set(base.x, site.y(chamber.batea) + (height * site.exaggeration) / 2, base.z);
    mesh.castShadow = true;
    mesh.userData.pickable =
      `${chamber.id} · camara de caida del box · terreno ${chamber.terreno.toFixed(2)} m, ` +
      `batea ${chamber.batea.toFixed(2)} m, entrada ${chamber.entrada.toFixed(2)} m, ` +
      `salida ${chamber.salida.toFixed(2)} m`;
    group.add(mesh);
  }

  // -------------------------------------------------- entrada, salida y aletas
  for (const [end, label] of [
    [config.entrada, "estructura de entrada"],
    [config.salida, "estructura de salida"],
  ]) {
    if (!end) continue;
    const sign = end === config.entrada ? -1 : 1;   // hacia afuera del box
    const p = at(end.station);
    // el cabezal va al invert del box en su extremo; el "fondo" publicado es
    // el de la llave antisocavacion, que en la entrada queda al pie de la
    // rapida, 14 m mas abajo que el arranque
    const zBase = end === config.entrada ? profile[0].z : profile[profile.length - 1].z;
    const head = new THREE.Mesh(new THREE.BoxGeometry(outer + 1.6, outerH + 0.6, 0.3), concrete);
    const centre = place(end.station, 0, zBase + (outerH + 0.6) / 2);
    head.position.copy(centre);
    head.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(p.dx, 0, -p.dy)
    );
    head.userData.pickable = end.llave !== undefined
      ? `${label} del box · llave antisocavacion ${end.llave.toFixed(2)} m, fondo ${end.fondo.toFixed(2)} m`
      : `${label} del box · invert ${zBase.toFixed(2)} m`;
    group.add(head);

    for (const wing of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, outerH + 0.4, WING_LENGTH), concrete);
      // aletas a 45 grados abriendo aguas afuera
      const angle = Math.atan2(-p.dy, p.dx) + sign * Math.PI + wing * (Math.PI / 4);
      const ax = Math.cos(angle);
      const az = Math.sin(angle);
      const foot = place(end.station, wing * (outer / 2 + 0.1), zBase + (outerH + 0.4) / 2);
      mesh.position.set(
        foot.x + ax * (WING_LENGTH / 2),
        foot.y,
        foot.z + az * (WING_LENGTH / 2)
      );
      mesh.quaternion.setFromAxisAngle(up, -angle);
      mesh.userData.pickable = `aleta de ${label} · detalle de entrada y salida (L ${WING_LENGTH.toFixed(1)} m)`;
      group.add(mesh);
    }
  }

  // -------------------------------------------------------- franja de terreno
  // el corredor cae fuera del MDT: esta franja sale del perfil impreso en la
  // lamina estructural y se dibuja translucida para declarar que es apoyo
  const endStation = config.salida ? config.salida.station : axis[axis.length - 1].station;
  if (config.franja === false) {
    // dentro del MDT no hace falta franja propia: el terreno del modelo ya
    // cubre el corredor
    group.userData = { config };
    return group;
  }
  const positions = [];
  const indices = [];
  const STEP = 10;
  let row = 0;
  for (let st = 0; st <= endStation + 1e-6; st += STEP) {
    const z = terrainAt(st);
    const left = place(st, -RIBBON_HALF, z);
    const right = place(st, RIBBON_HALF, z);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (row > 0) {
      const a = (row - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    row += 1;
  }
  const ribbonGeom = new THREE.BufferGeometry();
  ribbonGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  ribbonGeom.setIndex(indices);
  ribbonGeom.computeVertexNormals();
  const ribbon = new THREE.Mesh(ribbonGeom, ribbonMat);
  ribbon.userData.pickable =
    "Franja de terreno del corredor del box: perfil impreso en la lamina estructural (no MDT)";
  ribbon.renderOrder = 1;
  group.add(ribbon);

  group.userData = { config };
  return group;
}

function formatStation(value) {
  return `${Math.floor(value / 1000)}+${String(Math.round(value % 1000)).padStart(3, "0")}`;
}
