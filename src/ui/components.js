import * as THREE from "three";
import { basinFootprint } from "../layers/basins.js";
import { PALETTE, cssColor } from "../core/palette.js";

const COMPONENTS = {
  conjunto: ["Conjunto del proyecto", "#d6e1e2"],
  dique: ["Diques iniciales", cssColor(PALETTE.dike)],
  excavacion: ["Excavacion / rasante inicial", cssColor(PALETTE.excavation)],
  geomembrana: ["Geomembrana PEAD", cssColor(PALETTE.membrane)],
  geotextilInferior: ["Geotextil inferior", cssColor(PALETTE.textileLower)],
  geotextilSuperior: ["Geotextil superior", cssColor(PALETTE.textileUpper)],
  filtros: ["Filtros de lixiviados", cssColor(PALETTE.stone)],
  tuberias: ["Tuberias PEAD", cssColor(PALETTE.pipe6)],
  aguasLluvias: ["Canales de aguas lluvias", cssColor(PALETTE.channel)],
  alcantarillas: ["Alcantarillas", cssColor(PALETTE.concrete)],
};

export function buildComponentInspector(ctx) {
  const { state, viewer, groups, model, site } = ctx;
  const panel = document.createElement("section");
  panel.className = "panel component-panel";
  panel.innerHTML = `<div class="panel-head"><h2>Explorar el proyecto</h2></div>
    <label class="component-field">Vaso<select id="basin-filter">
      <option value="todos">Todos los vasos</option><option value="vaso1">Vaso 1</option>
      <option value="vaso2">Vaso 2</option><option value="vaso3">Vaso 3</option></select></label>
    <label class="component-field">Elemento<select id="component-filter"></select></label>
    <label class="component-field" id="component-item-row" hidden>Tramo<select id="component-item"></select></label>
    <div class="component-actions"><button type="button" id="component-focus">Acercar</button>
      <button type="button" id="component-reset">Ver conjunto</button></div>
    <label class="component-context"><input type="checkbox" id="component-terrain" checked> Terreno de contexto</label>
    <p id="component-status" class="panel-note" aria-live="polite"></p>
    <details><summary>Alcance del filtro</summary><p class="panel-note">Vasos y laminas: pertenencia del modelo.
      Redes y obras compartidas: recorte espacial alrededor del vaso, no asignacion de propiedad.
      Las cotas y coordenadas permanecen en su lugar.</p></details>`;
  document.querySelector(".sidebar").prepend(panel);
  const select = panel.querySelector("#component-filter");
  for (const [key, [label]] of Object.entries(COMPONENTS)) select.add(new Option(label, key));
  const basinSelect = panel.querySelector("#basin-filter");
  const itemSelect = panel.querySelector("#component-item");
  const status = panel.querySelector("#component-status");
  let items = [];
  let bounds = null;
  const legend = document.querySelector("#legend");
  const fullLegend = legend.innerHTML;

  function selected(key) { return (state.basin === "todos" || state.basin === key) && state.layers[key]; }
  function targets() {
    const phases = [...groups.basins.userData.byPhase.values()].filter(g => selected(g.userData.vaso));
    if (state.component === "dique") return phases.map(g => g.userData.dike).filter(Boolean);
    if (state.component === "excavacion") return phases.filter(g => g.userData.phase === model.vasos[g.userData.vaso].fases[0]).map(g => g.userData.rasante).filter(Boolean);
    if (["geomembrana", "geotextilInferior", "geotextilSuperior"].includes(state.component)) {
      return [...groups.linings.userData.byKey].filter(([key]) => selected(key)).map(([, g]) => g.userData.byKey.get(state.component));
    }
    if (state.component === "alcantarillas") return groups.works.userData.byKey.get("alcantarillas")?.children || [];
    const nets = groups.networks.userData.byKey;
    if (["filtros", "tuberias"].includes(state.component)) return ["tuberia6", "tuberia10"].flatMap(k => nets.get(k)?.children || []);
    if (state.component === "aguasLluvias") return nets.get("aguasLluvias")?.children || [];
    return [...groups.basins.userData.byVaso].filter(([key]) => selected(key)).map(([, g]) => g);
  }

  function samples(objects) {
    const points = [];
    for (const object of objects) object.traverseVisible(node => {
      const pos = node.geometry?.attributes.position;
      if (!pos) return;
      node.updateWorldMatrix(true, false);
      const stride = Math.max(1, Math.floor(pos.count / 1000));
      for (let i = 0; i < pos.count; i += stride) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
        if (!bounds || (p.x >= bounds.min.x && p.x <= bounds.max.x && p.z >= bounds.min.z && p.z <= bounds.max.z)) points.push(p);
      }
    });
    return points;
  }

  ctx.applyScope = () => {
    bounds = null;
    if (state.basin !== "todos") {
      const poly = basinFootprint(model.vasos[state.basin], 0);
      if (poly) {
        bounds = new THREE.Box3().setFromPoints(poly.map(([e, n]) => new THREE.Vector3(site.x(e), 0, site.z(n))));
        bounds.expandByScalar(8);
      }
    }
    viewer.renderer.clippingPlanes = bounds ? [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds.min.x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.max.x),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -bounds.min.z),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), bounds.max.z),
    ] : [];
    viewer.groups.get("topografia").userData.skirt.visible = state.layers.zocalo && state.basin === "todos";
    for (const [key, group] of groups.basins.userData.byVaso) group.visible = selected(key);
    for (const mesh of groups.surfaces.userData.byKey.get("llenadoFinal").children) {
      mesh.visible = selected(mesh.userData.vaso);
    }
    for (const [key, group] of groups.linings.userData.byKey) {
      group.visible = selected(key);
      for (const [sheet, mesh] of group.userData.byKey) mesh.visible = sheet === state.sheet;
    }
    for (const name of ["chimeneas", "rotulos", "zanja", "eje"]) {
      for (const object of viewer.groups.get(name).children) {
        const key = object.userData.vaso || (name === "eje" ? object.name : null);
        if (key) object.visible = selected(key);
      }
    }
    const raw = targets();
    items = raw.filter(object => {
      if (!bounds) return true;
      const box = new THREE.Box3().setFromObject(object);
      return box.max.x >= bounds.min.x && box.min.x <= bounds.max.x && box.max.z >= bounds.min.z && box.min.z <= bounds.max.z;
    });
    status.textContent = `${COMPONENTS[state.component][0]} · ${items.length} ${state.component === "conjunto" ? "vasos" : "elementos"}${state.basin !== "todos" ? " en el entorno seleccionado" : ""}.`;
    if (state.component === "alcantarillas") status.textContent += " Traza del plano; diametro visible simbolico de 0,56 m, sin cota verificada para cada trazo.";
    if (state.component === "dique") status.textContent += " Malla visual, no apta para cubicaciones: diferencia de 1,88 % respecto al lleno inicial publicado del vaso 2.";
    if (["filtros","tuberias"].includes(state.component)) status.textContent += " Flechas de 9 px: simbolos de flujo, no dimensiones de obra.";
    if (state.component.startsWith("geo")) status.textContent += " Se muestra una lamina a la vez; separacion grafica de 0,05 / 0,35 / 0,65 m.";
    legend.innerHTML = state.component === "conjunto" ? fullLegend :
      `<div class="legend-block"><h4>${state.basin === "todos" ? "Todos los vasos" : state.basin.replace("vaso", "Vaso ")}</h4>
       <div class="legend-row"><i style="background:${COMPONENTS[state.component][1]}"></i><span>${COMPONENTS[state.component][0]}</span></div>
       <div class="legend-row"><span>${state.component.startsWith("geo") ? "Una lamina visible; separacion de representacion" : "Posicion original del modelo"}</span></div></div>`;
    const old = itemSelect.value;
    itemSelect.replaceChildren(new Option("Todos los tramos", "todos"));
    items.forEach((_, i) => itemSelect.add(new Option(`Tramo ${i + 1}`, String(i))));
    if ([...itemSelect.options].some(o => o.value === old)) itemSelect.value = old;
    panel.querySelector("#component-item-row").hidden = !["alcantarillas", "filtros", "tuberias", "aguasLluvias"].includes(state.component);
    panel.querySelector("#component-focus").disabled = items.length === 0;
    ctx.syncComponents();
  };

  ctx.syncComponents = () => {
    select.value = state.component;
    basinSelect.value = state.basin;
    panel.querySelector("#component-terrain").checked = state.layers.topografia;
    document.querySelectorAll("#layer-controls input[data-layer]").forEach(input => { input.checked = Boolean(state.layers[input.dataset.layer]); });
  };

  ctx.focusComponent = () => {
    const chosen = itemSelect.value !== "todos" && !panel.querySelector("#component-item-row").hidden ? [items[Number(itemSelect.value)]] : items;
    const points = samples(chosen.filter(Boolean));
    if (!points.length) { status.textContent += " Sin geometria visible en este recorte."; return; }
    const shot = viewer.framePoints(points, new THREE.Vector3(0.7, 1.05, 0.85), 1.2, 0.08);
    viewer.flyTo(shot.position, shot.target);
  };

  function changeComponent() {
    const requested = select.value;
    ctx.restoreInspection?.();
    ctx.restoreInspection = null;
    state.component = requested;
    state.view = "tecnicas";
    viewer.setPlanMode(false);
    ctx.cut.setEnabled(false);
    document.body.classList.remove("is-section");
    document.querySelectorAll(".view-button").forEach(b => b.classList.toggle("is-active", b.dataset.view === "tecnicas"));
    Object.assign(state.layers, { movimiento: false, dique: false, geosinteticos: false,
      filtros: false, tuberias: false, aguasLluvias: false, drenajes: false, vias: false,
      estabilizacion: false, alcantarillas: false, curvas: false, planimetria: false,
      eje: false, rotulos: false, puntos: false, chimeneas: false, curvasProyecto: false,
      superficieObras: false, superficieLlenado: false, dron: false, planoReferencia: false });
    const component = state.component;
    if (component === "conjunto") Object.assign(state.layers, { movimiento: true, dique: true, vias: true, rotulos: true, alcantarillas: true });
    else if (component === "excavacion") state.layers.movimiento = true;
    else if (component.startsWith("geo")) { state.layers.geosinteticos = true; state.sheet = component; }
    else state.layers[component] = true;
    itemSelect.value = "todos";
    ctx.applyLayers();
    ctx.focusComponent();
  }
  select.addEventListener("change", changeComponent);
  basinSelect.addEventListener("change", () => {
    state.basin = basinSelect.value;
    if (state.basin !== "todos") state.layers[state.basin] = true;
    if (state.view === "perfil" && state.basin !== "todos") ctx.setCutVaso(state.basin);
    itemSelect.value = "todos";
    ctx.applyLayers();
    if (state.view !== "perfil") ctx.focusComponent();
  });
  itemSelect.addEventListener("change", ctx.focusComponent);
  panel.querySelector("#component-focus").addEventListener("click", ctx.focusComponent);
  panel.querySelector("#component-reset").addEventListener("click", () => { select.value = "conjunto"; changeComponent(); });
  panel.querySelector("#component-terrain").addEventListener("change", e => {
    state.layers.topografia = e.target.checked;
    ctx.applyLayers();
  });
}
