import * as THREE from "three";
import { Site } from "./core/site.js";
import { SectionCut } from "./core/section-cut.js";
import { Viewer } from "./core/viewer.js";
import { buildContours, buildTerrain } from "./layers/terrain.js";
import {
  PHASE_STYLE,
  allFootprints,
  buildAlignments,
  buildBasins,
  pointInPolygon,
} from "./layers/basins.js";
import {
  BasinSurface,
  buildManholes,
  buildNetworks,
  buildPlanimetry,
  buildSurveyPoints,
  makeBottomSampler,
  makeDrapeSampler,
} from "./layers/networks.js";
import { LINING_SEPARATION_NOTE, buildAnchorTrench, buildLinings } from "./layers/linings.js";
import { buildChimneys } from "./layers/chimneys.js";
import { buildDesignSurfaces } from "./layers/designSurfaces.js";
import { buildDrone, buildGroundSampler, measureVerticalOffset } from "./layers/drone.js";
import { buildLabels } from "./layers/labels.js";
import { buildPlanSheet } from "./layers/planSheet.js";
import { buildPiezometers, buildWorks } from "./layers/works.js";
import { buildBoxCulvert } from "./layers/boxCulvert.js";
import { buildOrthophoto } from "./layers/orthophoto.js";
import { buildDike } from "./layers/dike.js";
import { buildUi } from "./ui/panel.js";
import { CHANNEL_NOTE } from "./layers/channels.js";
import { buildComponentInspector } from "./ui/components.js";
import { PALETTE } from "./core/palette.js";
import { buildPresentation } from "./ui/presentation.js";

// Muestras de vertices por capa, para encajar la camara sin recalcularlas.
const sampleCache = new Map();

const canvas = document.querySelector("#scene");
const loading = document.querySelector("#loading");
const loadingDetail = document.querySelector("#loading-detail");

const state = {
  phase: 3,
  planKey: "topografia",
  exaggeration: 1,
  basin: "todos",
  component: "conjunto",
  sheet: "geomembrana",
  view: "general",
  layers: {
    topografia: true,
    zocalo: false,
    curvas: false,
    vaso1: true,
    vaso2: true,
    vaso3: true,
    movimiento: true,
    historial: false,
    dique: true,
    chimeneas: true,
    geosinteticos: false,
    filtros: true,
    aguasLluvias: false,
    drenajes: false,
    tuberias: true,
    eje: false,
    limite: true,
    planimetria: false,
    puntos: false,
    rotulos: true,
    vias: true,
    estabilizacion: true,
    alcantarillas: true,
    curvasProyecto: false,
    piezometros: false,
    superficieObras: false,
    superficieLlenado: false,
    planoReferencia: false,
    dron: false,
    boxCulvert: true,
    jarillon: true,
    ortofoto: false,
  },
};

boot().catch((error) => {
  console.error(error);
  loading.textContent = "No se pudo cargar el visor";
  loadingDetail.textContent = String(error && error.message ? error.message : error);
});

async function boot() {
  loadingDetail.textContent = "Leyendo modelo del sitio";
  const [terrain, model, designSurfaces, droneConfig, topographyAudit, boxCulvertData, orthophotoData] = await Promise.all([
    fetch("data/terrain.json").then((r) => r.json()),
    fetch("data/site-model.json").then((r) => r.json()),
    fetch("data/design-surfaces.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch("data/dron.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch("verification/topography-audit.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch("data/box-culvert.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch("data/orthophoto.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const site = new Site(terrain);
  const viewer = new Viewer(canvas, site);

  loadingDetail.textContent = "Construyendo terreno";
  // la huella intervenida de los vasos se recorta del terreno natural
  // margen negativo: el recorte queda un poco dentro del cuerpo de los vasos,
  // para que el borde dentado de la malla no asome entre el terreno y la obra
  const footprints = allFootprints(model, -2.0);
  const terrainGroup = viewer.register(
    "topografia",
    buildTerrain(terrain, site, footprints, pointInPolygon)
  );
  const terrainMesh = terrainGroup.userData.mesh;
  viewer.register("curvas", buildContours(terrain, site));

  loadingDetail.textContent = "Construyendo vasos y fases";
  const basins = viewer.register("vasos", buildBasins(model, site));
  viewer.register("eje", buildAlignments(model, site));

  // superficie de apoyo de cada vaso: la rasante de su primera etapa
  const basinSurfaces = [];
  for (const vaso of Object.values(model.vasos)) {
    const first = vaso.fases[0];
    if (first) basinSurfaces.push(new BasinSurface(vaso, first));
  }
  const drape = makeDrapeSampler(site, basinSurfaces);
  const bottomDrape = makeBottomSampler(site, basinSurfaces);

  loadingDetail.textContent = "Construyendo redes tecnicas";
  const networks = viewer.register("redes", buildNetworks(model, site, drape, bottomDrape));
  const linings = viewer.register("geosinteticos", buildLinings(model, site));
  const trench = viewer.register("zanja", buildAnchorTrench(model, site));
  const planimetry = viewer.register("planimetria", buildPlanimetry(model, site));
  const manholes = viewer.register("pozos", buildManholes(model, site, drape));
  const survey = viewer.register("puntosTopo", buildSurveyPoints(model, site, drape));
  const labels = viewer.register("rotulos", buildLabels(model, site, drape));
  // Las vias, alcantarillas y obras van sobre el TERRENO, no sobre la rasante
  // de diseno: con el drape de diseno quedaban flotando sobre el relleno aun
  // no construido. bottomDrape = minimo entre diseno y terreno -> nunca vuelan.
  const works = viewer.register("obras", buildWorks(model, site, bottomDrape));
  const chimneys = viewer.register("chimeneas", buildChimneys(model, site, bottomDrape));
  const piezometers = viewer.register("piezometros", buildPiezometers(model, site, drape));
  // ocupacion de cauce de la Q. Sin Nombre: laminas propias, georreferenciadas
  const boxCulvert = viewer.register("boxCulvert", buildBoxCulvert(boxCulvertData, site));
  const orthophoto = viewer.register("ortofoto", buildOrthophoto(orthophotoData, site));
  const jarillon = viewer.register("jarillon", buildDike(model, site));
  const surfaces = viewer.register("superficies", buildDesignSurfaces(designSurfaces, site, model));

  const planSheet = viewer.register("planoReferencia", buildPlanSheet(terrainMesh, site, model.meta.planos));

  // el vuelo de dron pesa y no siempre hace falta: se carga aparte y al final
  const drone = viewer.register("dron", new THREE.Group());
  drone.visible = false;
  let dronePromise = null;
  function ensureDrone() {
    if (!droneConfig) return Promise.resolve(null);
    if (!dronePromise) {
      loadingDetail.textContent = "Cargando vuelo de dron";
      dronePromise = buildDrone(droneConfig, site, (ratio) => {
        document.dispatchEvent(new CustomEvent("visor:dron", { detail: ratio }));
      }).then((built) => {
        drone.add(built);
        built.visible = true;
        return built;
      });
    }
    return dronePromise;
  }

  // Con el vuelo activo, lo que se cuelga del terreno se posa sobre el suelo
  // del levantamiento. El vuelo es la superficie ACTUAL del sitio y el resto
  // del modelo se drapea sobre el terreno de los planos: donde el sitio ya
  // cambio, las vias, alcantarillas y lineas del levantamiento quedaban
  // flotando o enterradas bajo la malla del dron. Las chimeneas ademas se
  // prolongan hasta ese suelo: suben con el relleno, y el relleno actual es
  // el que midio el dron.
  let droneGround = null;
  let groundedOnDrone = false;
  let regroundPending = null;

  function applyDroneGround(active) {
    if (regroundPending || active === groundedOnDrone) return;
    regroundPending = regroundDrone(active).finally(() => {
      regroundPending = null;
      // si la capa cambio mientras se reconstruia, se vuelve a ajustar
      if (Boolean(state.layers.dron) !== groundedOnDrone) {
        applyDroneGround(Boolean(state.layers.dron));
      }
    });
  }

  async function regroundDrone(active) {
    if (active) {
      await ensureDrone();
      if (!droneGround) droneGround = buildGroundSampler(drone, site);
    }
    groundedOnDrone = active;
    const onWorks = active ? (e, n) => droneGround(e, n) ?? bottomDrape(e, n) : bottomDrape;
    const onGround = active ? (e, n) => droneGround(e, n) ?? site.elevationAt(e, n) : null;
    repopulate(works, buildWorks(model, site, onWorks));
    repopulate(planimetry, buildPlanimetry(model, site, onGround));
    chimneys.userData.setGroundSampler(active ? droneGround : null);
    // los materiales nuevos tienen que entrar al recorte transversal
    cut.collect(
      [...viewer.groups.entries()].filter(([key]) => !NO_CLIP.has(key)).map(([, group]) => group)
    );
    cut.setEnabled(cut.enabled);
    applyLayers();
  }

  /** Sustituye el contenido de un grupo conservando su identidad. */
  function repopulate(group, built) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        // las texturas compartidas a nivel de modulo no se tocan
        for (const material of materials) material && material.dispose && material.dispose();
      });
    }
    for (const child of [...built.children]) group.add(child);
    group.userData = built.userData;
  }

  // corte transversal: el equivalente en el visor a las secciones del plano
  const cut = new SectionCut(viewer, site, model.vasos, "vaso2");
  // Se recorta todo lo que tiene cuerpo en el sitio: lo que quede fuera se
  // sigue dibujando por delante del corte y tapa la seccion. Se enumeran las
  // excepciones en vez de los incluidos, para que una capa nueva entre sola.
  const NO_CLIP = new Set(["rotulos", "planoReferencia", "dron"]);
  cut.collect(
    [...viewer.groups.entries()].filter(([key]) => !NO_CLIP.has(key)).map(([, group]) => group)
  );
  cut.setStation(cut.station);

  const context = {
    state,
    site,
    viewer,
    model,
    terrain,
    topographyAudit,
    designSurfaces,
    groups: { basins, networks, linings, trench, planimetry, manholes, survey, planSheet, works, surfaces, piezometers },
    cut,
    setCutStation,
    setCutVaso,
    notes: {
      lining: LINING_SEPARATION_NOTE,
      filters:
        "Filtros de lixiviados: la altura de 0,78 m y los diametros de tuberia son reales; " +
        "el ancho visible de la zanja y la malla es un simbolo grafico porque el plano solo " +
        "publica el eje en planta y el detalle constructivo.",
      drainage: CHANNEL_NOTE,
      operation:
        "Masa de residuos: las cubiertas, bandas de compactacion y frente activo son una " +
        "representacion visual pegada a las rasantes de etapa de los planos; no anaden " +
        "celdas, cotas ni volumenes nuevos.",
    },
    phaseStyle: PHASE_STYLE,
    applyLayers,
    applyPhase,
    setExaggeration,
    setPlan,
    droneConfig,
    ensureDrone,
    // comprobacion del desfase altimetrico del vuelo, desde la consola
    async medirDesfaseDron() {
      const built = await ensureDrone();
      if (!built) return null;
      return measureVerticalOffset(built, site, terrain, model.planimetria);
    },
    frame,
  };

  // util para depurar desde la consola del navegador
  window.visor = context;

  buildUi(context);
  buildComponentInspector(context);
  applyLayers();
  applyPhase();
  viewer.resize();
  frame("general");
  buildPresentation(context);

  loading.classList.add("is-hidden");
  animate();

  function animate() {
    requestAnimationFrame(animate);
    if (labels.userData.update) labels.userData.update(viewer.activeCamera, context);
    viewer.render();
  }

  // ---------------------------------------------------------------- capas
  function applyLayers() {
    const L = state.layers;
    viewer.setLayerVisible("topografia", L.topografia);
    terrainGroup.userData.skirt.visible = L.zocalo;
    viewer.setLayerVisible("curvas", L.curvas && L.topografia);
    viewer.setLayerVisible("eje", L.eje);
    viewer.setLayerVisible("planimetria", L.planimetria);
    viewer.setLayerVisible("geosinteticos", L.geosinteticos);
    viewer.setLayerVisible("zanja", L.geosinteticos);
    viewer.setLayerVisible("pozos", L.filtros || L.tuberias);
    viewer.setLayerVisible("puntosTopo", L.puntos);
    viewer.setLayerVisible("rotulos", L.rotulos);
    viewer.setLayerVisible("planoReferencia", L.planoReferencia);
    viewer.setLayerVisible("dron", L.dron);
    if (L.dron) ensureDrone();
    applyDroneGround(Boolean(L.dron));
    document.dispatchEvent(new CustomEvent("visor:dron-visible", { detail: L.dron }));

    viewer.setLayerVisible("piezometros", L.piezometros);
    viewer.setLayerVisible("boxCulvert", L.boxCulvert);
    viewer.setLayerVisible("jarillon", L.jarillon);
    viewer.setLayerVisible("ortofoto", L.ortofoto);
    // el panel "Detalle de canales" solo aparece con capas de agua/box activas
    const channelPanel = document.querySelector("#channel-panel");
    if (channelPanel) channelPanel.hidden = !L.aguasLluvias;
    document.dispatchEvent(new CustomEvent("visor:ortofoto-visible", { detail: L.ortofoto }));
    viewer.setLayerVisible("chimeneas", L.chimeneas);

    // las obras se agrupan en tres interruptores
    const ESTABILIZACION = new Set(["hombros", "patas", "alcantarillas", "pisoDuro"]);
    const CONTORNOS = new Set(["contornoVaso", "limiteProyecto", "curvasProyecto"]);
    const worksByKey = works.userData.byKey;
    let anyWork = false;
    for (const [key, obj] of worksByKey) {
      if (key === "alcantarillas") obj.visible = L.alcantarillas;
      else if (CONTORNOS.has(key)) obj.visible = L.curvasProyecto;
      else if (ESTABILIZACION.has(key)) obj.visible = L.estabilizacion;
      else obj.visible = L.vias;
      anyWork = anyWork || obj.visible;
    }
    works.visible = anyWork;

    basins.visible = L.movimiento || L.dique || (L.superficieLlenado && state.view === "perfil");
    const byVaso = basins.userData.byVaso;
    for (const [key, group] of byVaso) group.visible = Boolean(L[key]);

    const bySurface = surfaces.userData.byKey;
    if (bySurface.get("obrasIniciales")) {
      bySurface.get("obrasIniciales").visible = L.superficieObras;
    }
    if (bySurface.get("llenadoFinal")) {
      bySurface.get("llenadoFinal").visible = L.superficieLlenado;
    }
    surfaces.visible = L.superficieObras || L.superficieLlenado;

    const byKey = networks.userData.byKey;
    const show = (key, on) => {
      const g = byKey.get(key);
      if (g) g.visible = on;
    };
    show("tuberia6", L.tuberias || L.filtros);
    show("tuberia10", L.tuberias || L.filtros);
    show("aguasLluvias", L.aguasLluvias);
    show("zanjaAnclaje", L.geosinteticos);
    show("cuneta", L.drenajes);
    for (const key of ["tuberia6", "tuberia10"]) byKey.get(key)?.traverse(node => {
      if (node.userData.filterPart === "filtro") node.visible = L.filtros;
      if (node.userData.filterPart === "tuberia") node.visible = L.tuberias || L.filtros;
      if (node.userData.filterPart === "flujo") node.visible = L.filtros;
    });

    const plani = planimetry.userData.byKey;
    for (const [key, obj] of plani) {
      if (key === "cunetas" || key === "tuberias") obj.visible = L.drenajes;
      else obj.visible = L.planimetria;
    }
    if (plani.get("tuberias")) plani.get("tuberias").visible = L.tuberias;

    if (basins.userData.byPhase.size) applyPhase();
    context.applyScope?.();
  }

  // ---------------------------------------------------------------- fases
  function applyPhase() {
    // La coronacion final, el corte y las chimeneas deben describir el mismo estado.
    const displayPhase = state.layers.superficieLlenado
      ? Math.max(...Object.values(model.vasos).flatMap(v => v.fases.map(p => Number(p.split("/")[1]))))
      : state.phase;
    // En perfil los cuerpos cerrados ya contienen la cara superior final.
    surfaces.userData.byKey.get("llenadoFinal").visible = state.layers.superficieLlenado && state.view !== "perfil";
    basins.visible = state.layers.movimiento || state.layers.dique || (state.layers.superficieLlenado && state.view === "perfil");
    // con los geosinteticos encendidos, las etapas superiores se vuelven muy
    // translucidas: el recubrimiento va sobre la excavacion y quedaria tapado
    const lining = state.layers.geosinteticos;
    for (const [key, group] of basins.userData.byPhase) {
      const n = Number(key.split("/")[1]);
      const phases = model.vasos[group.userData.vaso].fases;
      const first = key === phases[0];
      const available = phases.filter(p => Number(p.split("/")[1]) <= displayPhase);
      const current = key === (available.at(-1) || phases[0]);
      const excavation = state.component === "excavacion";
      const dikeContext = state.component === "dique" && state.layers.topografia;
      group.visible = first || n <= displayPhase;
      const dike = group.userData.dike;
      // La rasante posterior ya contiene el lleno inicial; superponer ambos
      // muestreos dibujaba franjas que no representan nuevas obras.
      if (dike) dike.visible = state.layers.dique && (!state.layers.movimiento || current || state.view === "perfil");
      if (group.userData.operation && group.userData.operation.userData.setCurrent) {
        group.userData.operation.visible = false;
      }
      const surface = group.userData.rasante;
      if (surface) {
        const previous = state.view === "fases" && state.layers.historial && !current && n <= state.phase;
        surface.visible = ((state.layers.movimiento && (excavation ? first : current || previous)) || (dikeContext && first)) && !lining && !state.layers.superficieLlenado && state.view !== "perfil";
        surface.material.opacity = previous ? 0.14 : 1;
        surface.material.transparent = previous;
        surface.material.depthWrite = !previous;
        surface.material.vertexColors = !(excavation || dikeContext);
        surface.material.color.set(excavation || dikeContext ? PALETTE.excavation : 0xffffff);
        surface.material.needsUpdate = true;
      }
      const mesh = group.userData.mesh;
      if (!mesh) continue;
      // La superficie resultante comunica la obra. Los solidos completos se
      // reservan al perfil; superponer sus techos de terreno ocultaba las rasantes.
      mesh.visible = (state.layers.movimiento || state.layers.superficieLlenado) && state.view === "perfil" && (n <= displayPhase || first);
      const opacity = 1;
      mesh.material.opacity = opacity;
      mesh.material.transparent = opacity < 1;
      mesh.material.depthWrite = opacity >= 1;
      mesh.material.needsUpdate = true;
    }
    // las chimeneas suben con el relleno: crecen al cambiar de fase
    chimneys.userData.update(displayPhase);
    cut.setPhaseLimit(displayPhase);
    document.dispatchEvent(new CustomEvent("visor:phase", { detail: displayPhase }));
    context.applyScope?.();
    context.refreshPresentation?.();
  }

  function setExaggeration(value) {
    if (value === site.exaggeration) return;
    state.exaggeration = value;
    const factor = value / site.exaggeration;
    site.exaggeration = value;
    for (const group of viewer.groups.values()) scaleY(group, factor);
    document.dispatchEvent(new CustomEvent("visor:exaggeration", { detail: value }));
  }

  function scaleY(object, factor) {
    object.traverse((node) => {
      if (node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
        const pos = node.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 1) pos.setY(i, pos.getY(i) * factor);
        pos.needsUpdate = true;
        node.geometry.computeBoundingSphere();
        if (node.geometry.attributes.normal) node.geometry.computeVertexNormals();
      } else if (node.isSprite || node.isMesh) {
        node.position.y *= factor;
      }
    });
  }

  function setCutStation(station) {
    cut.setStation(station);
    document.dispatchEvent(new CustomEvent("visor:section", { detail: cut.sectionData() }));
    if (cut.enabled) {
      const shot = cut.cameraShot(station);
      viewer.flyTo(shot.position, shot.target, 450);
    }
  }

  function setCutVaso(key) {
    cut.setVaso(key);
    document.dispatchEvent(new CustomEvent("visor:section", { detail: cut.sectionData() }));
    if (cut.enabled) {
      const shot = cut.cameraShot(cut.station);
      viewer.flyTo(shot.position, shot.target, 450);
    }
  }

  async function setPlan(key) {
    state.planKey = key;
    const plan = await planSheet.userData.show(key);
    document.dispatchEvent(new CustomEvent("visor:plan", { detail: plan }));
  }

  // --------------------------------------------------------------- vistas
  /** Muestra de vertices de un grupo, para encajar la camara. */
  function sampleVertices(object, stride = 7) {
    const out = [];
    object.traverse((node) => {
      if (!node.isMesh && !node.isLine) return;
      const pos = node.geometry.attributes.position;
      if (!pos) return;
      node.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i += stride) {
        out.push(
          new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(node.matrixWorld)
        );
      }
    });
    return out;
  }

  function cached(key, object, stride) {
    if (!sampleCache.has(key)) sampleCache.set(key, sampleVertices(object, stride));
    return sampleCache.get(key);
  }

  /** Grupo virtual con solo los cuerpos de dique, para encuadrarlos. */
  function dikeGroup() {
    const group = new THREE.Group();
    for (const phaseGroup of basins.userData.byPhase.values()) {
      if (phaseGroup.userData.dike) group.add(phaseGroup.userData.dike.clone());
    }
    return group;
  }

  function frame(mode) {
    if (context.restoreInspection) {
      context.restoreInspection();
      context.restoreInspection = null;
    }
    state.view = mode;
    viewer.setPlanMode(mode === "planta");
    cut.setEnabled(mode === "perfil");
    document.body.classList.toggle("is-section", mode === "perfil");
    // la leyenda se superpone al pie del lienzo: el encuadre sube un poco
    // para que no tape el modelo
    const go = (points, dir, padding, bias = 0.07) => {
      if (!points.length) return;
      const shot = viewer.framePoints(points, dir, padding, bias);
      viewer.flyTo(shot.position, shot.target);
    };
    const sitePoints = cached("site", terrainGroup, 11);
    const basinPoints = cached("basin", basins, 3);
    const dikePoints = cached("dike", dikeGroup(), 1);
    const site3d = sitePoints.length ? sitePoints : basinPoints;
    const basin3d = basinPoints.length ? basinPoints : sitePoints;

    switch (mode) {
      case "planta":
        go(site3d, new THREE.Vector3(0, 1, 0.0001), 1.02);
        break;
      case "3d":
        go(site3d, new THREE.Vector3(0.7, 0.58, 1), 1.04);
        break;
      case "perfil": {
        // corte transversal real, como las secciones del plano
        const shot = cut.cameraShot(cut.station);
        viewer.flyTo(shot.position, shot.target);
        break;
      }
      case "fases":
        go(basin3d, new THREE.Vector3(-0.85, 0.7, 0.95), 1.12);
        break;
      case "tecnicas":
        go(basin3d, new THREE.Vector3(0.5, 0.62, 0.8), 1.25);
        break;
      case "dique":
        // desde fuera y algo bajo, que es como se lee un terraplen
        go(dikePoints.length ? dikePoints : basin3d, new THREE.Vector3(0.9, 0.85, 0.65), 1.15);
        break;
      case "general":
      default:
        go(site3d, new THREE.Vector3(0.6, 0.5, 0.95), 1.06);
        break;
    }
    context.refreshPresentation?.();
  }
}
