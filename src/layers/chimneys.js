import * as THREE from "three";
import { PALETTE } from "../core/palette.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { BasinSurface } from "./networks.js";

/**
 * Chimeneas de biogas.
 *
 * Los planos de geosinteticos publican sus coordenadas en la tabla "Puntos
 * topograficos - Chimeneas", pero no dibujan su seccion. La seccion viene de
 * las especificaciones tecnicas del proyecto, item 4.10:
 *
 *   "construccion de Chimeneas para evacuacion de biogas en malla galvanizada
 *    2x1x1 mts"  ...  "Disena un marco en forma de cubo con dimensiones de 2
 *    metros de altura, 1 metro de ancho y 1 metro de profundidad"
 *
 * Es decir un cajon de 1 x 1 m en planta que se levanta por modulos de 2 m de
 * alto, con la malla galvanizada fijada al marco. Dentro va piedra filtro de
 * 4" a 6" y la tuberia de 6" con su tee (items 4.5 a 4.7).
 *
 * Cada chimenea arranca en el fondo del vaso y se va levantando con el
 * relleno: crece hasta la coronacion de la etapa que se este mostrando, en
 * modulos enteros, que es lo que hace visible el avance del llenado.
 */
const SECTION = 1.0;         // m de lado del cajon (especificacion 4.10)
const MODULE = 2.0;          // m de alto de cada modulo (especificacion 4.10)
const PIPE_DIAMETER = 0.168; // m, tuberia de 6" (especificacion 4.7)

export function buildChimneys(model, site, drape) {
  const root = new THREE.Group();
  const list = (model.puntos && model.puntos.chimeneas) || [];
  if (!list.length) return Object.assign(root, { userData: { update: () => {} } });

  // superficie excavada de cada vaso, para arrancar la chimenea en el fondo
  const bottoms = new Map();
  // coronacion de cada etapa: hasta ahi llega el relleno y con el la chimenea
  const crests = new Map();
  for (const [vkey, vaso] of Object.entries(model.vasos)) {
    if (vaso.fases.length) bottoms.set(vkey, new BasinSurface(vaso, vaso.fases[0]));
    crests.set(
      vkey,
      (vaso.niveles || []).map((n) => ({
        number: Number(n.fase.split("/")[1]),
        crest: n.corona,
      }))
    );
  }

  // piedra filtro confinada por la malla
  const stone = new THREE.MeshStandardMaterial({
    color: PALETTE.stone,
    roughness: 0.95,
    metalness: 0.02,
  });
  // malla galvanizada: se ve el marco y la trama, y se transparenta la grava
  // Trazo en pantalla, no espesor de alambre del item 4.10.
  const mesh = new LineMaterial({ color: PALETTE.cage, linewidth: 1.25, transparent: true, opacity: 0.85 });
  const pipe = new THREE.MeshStandardMaterial({
    color: PALETTE.membrane,
    roughness: 0.55,
    metalness: 0.15,
  });

  const items = [];
  for (const chimney of list) {
    // el arranque esta en el fondo del vaso: se toma la cota publicada y, si
    // el plano no la da, la de la superficie excavada de la primera etapa
    const bottom = bottoms.get(chimney.vaso);
    const base =
      chimney.base !== null && chimney.base !== undefined
        ? chimney.base
        : (bottom && bottom.elevationAt(chimney.east, chimney.north)) ??
          drape(chimney.east, chimney.north);
    if (base === null || base === undefined) continue;

    const core = new THREE.Mesh(new THREE.BoxGeometry(SECTION * 0.7, 1, SECTION * 0.7), stone);
    const vent = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_DIAMETER / 2, PIPE_DIAMETER / 2, 1, 10),
      pipe
    );
    const tee = new THREE.Group();
    const teeBar = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_DIAMETER / 2, PIPE_DIAMETER / 2, SECTION * 0.86, 10),
      pipe
    );
    teeBar.rotation.z = Math.PI / 2;
    tee.add(teeBar);
    const capA = new THREE.Mesh(new THREE.SphereGeometry(PIPE_DIAMETER / 2, 10, 6), pipe);
    const capB = capA.clone();
    capA.position.x = -SECTION * 0.43;
    capB.position.x = SECTION * 0.43;
    tee.add(capA, capB);
    const cage = new LineSegments2(new LineSegmentsGeometry(), mesh);
    cage.onBeforeRender = renderer => renderer.getSize(mesh.resolution);
    core.castShadow = true;
    tee.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    root.add(core, vent, tee, cage);
    for (const object of [core, vent, tee, cage]) object.userData.vaso = chimney.vaso;
    items.push({ chimney, base, core, vent, tee, cage });
  }

  /**
   * Trama de la malla de un cajon de `modules` modulos.
   *
   * Se dibujan las cuatro aristas verticales y un anillo por modulo, de forma
   * que se vea de cuantos modulos de 2 m esta hecha la chimenea; la trama fina
   * de la malla no se dibuja porque a esta escala no se distingue.
   */
  function cageGeometry(modules) {
    const h = SECTION / 2;
    const corners = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    const top = modules * MODULE;
    const points = [];
    for (const [x, z] of corners) {
      points.push(x, 0, z, x, top, z);
    }
    for (let m = 0; m <= modules; m += 1) {
      const y = m * MODULE;
      for (let i = 0; i < 4; i += 1) {
        const [x1, z1] = corners[i];
        const [x2, z2] = corners[(i + 1) % 4];
        points.push(x1, y, z1, x2, y, z2);
      }
    }
    for (let m = 0; m < modules; m += 1) {
      const y0 = m * MODULE;
      const y1 = (m + 1) * MODULE;
      for (let i = 0; i < 4; i += 1) {
        const [x1, z1] = corners[i];
        const [x2, z2] = corners[(i + 1) % 4];
        points.push(x1, y0, z1, x2, y1, z2, x2, y0, z2, x1, y1, z1);
      }
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(points);
    return geometry;
  }

  // Suelo del vuelo de dron, cuando esa capa esta activa. La chimenea sube
  // con el relleno (asi lo documentan los planos) y el relleno ACTUAL es la
  // superficie que midio el dron: sobre el vuelo, la chimenea se muestra
  // plantada en ese suelo y asomando por encima. Es un ajuste de
  // representacion, no una cota de obra, y se declara en la lectura.
  let groundSampler = null;
  let lastPhase = 1;

  /** Recalcula la altura de cada chimenea para la fase que se muestra. */
  function update(phaseNumber) {
    lastPhase = phaseNumber;
    for (const item of items) {
      const { chimney, base: designBase, core, vent, tee, cage } = item;
      let crest = designBase;
      for (const stage of crests.get(chimney.vaso) || []) {
        if (stage.number <= phaseNumber && stage.crest !== null && stage.crest > crest) {
          crest = stage.crest;
        }
      }

      // con el vuelo activo: arranca como muy tarde en el suelo actual y
      // remata como muy pronto por encima de el
      let base = designBase;
      let droneNote = "";
      const droneZ = groundSampler ? groundSampler(chimney.east, chimney.north) : null;
      if (droneZ !== null && droneZ !== undefined) {
        base = Math.min(base, droneZ);
        crest = Math.max(crest, droneZ);
        droneNote = " · ajustada al suelo del vuelo de dron (representacion)";
      }

      // la chimenea se construye por modulos enteros de 2 m, asi que el ultimo
      // sobresale del relleno hasta que la tongada siguiente lo cubre
      const modules = Math.max(1, Math.ceil((crest - base) / MODULE));
      const height = modules * MODULE;
      const scaled = height * site.exaggeration;

      const x = site.x(chimney.east);
      const z = site.z(chimney.north);
      const y0 = site.y(base);

      core.scale.set(1, scaled, 1);
      core.position.set(x, y0 + scaled / 2, z);

      // la tuberia de 6" remata por encima del ultimo modulo
      const ventLength = scaled + 0.8;
      vent.scale.set(1, ventLength, 1);
      vent.position.set(x, y0 + ventLength / 2, z);
      tee.position.set(x, y0 + ventLength + 0.15, z);
      tee.scale.set(1, site.exaggeration, 1);

      cage.geometry.dispose();
      cage.geometry = cageGeometry(modules);
      cage.position.set(x, y0, z);
      cage.scale.set(1, site.exaggeration, 1);

      core.userData.pickable =
        `${chimney.id} · chimenea de biogas · ${chimney.zona} · ` +
        `base ${base.toFixed(2)} m, corona ${(base + height).toFixed(2)} m · ` +
        `${modules} modulos de malla galvanizada de 2 x 1 x 1 m${droneNote}`;
      vent.userData.pickable = core.userData.pickable;
      tee.userData.pickable = core.userData.pickable;
      cage.userData.pickable = core.userData.pickable;
    }
  }

  /** Activa o quita el ajuste al suelo del vuelo de dron. */
  function setGroundSampler(sampler) {
    groundSampler = sampler;
    update(lastPhase);
  }

  root.userData = { update, setGroundSampler, count: items.length };
  update(1);
  return root;
}
