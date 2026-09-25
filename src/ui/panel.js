import * as THREE from "three";

const LAYER_GROUPS = [
  {
    title: "Terreno",
    items: [
      ["topografia", "Topografía", "Superficie natural deducida de las curvas de nivel del plano"],
      ["zocalo", "Zocalo de maqueta", "Cierre vertical de representacion; no es un talud del proyecto"],
      ["curvas", "Curvas de nivel", "Curvas cada 1 m, directrices cada 5 m"],
      ["planimetria", "Planimetría", "Vías, caños, linderos, cercos y obras del levantamiento"],
      ["puntos", "Puntos topográficos", "CH1 a CH8 con coordenadas publicadas en el plano"],
      ["rotulos", "Rótulos", "Nombre de cada vaso sobre el modelo"],
    ],
  },
  {
    title: "Vasos y movimiento de tierras",
    items: [
      ["movimiento", "Movimiento de tierras", "Cuerpos de corte y lleno por etapa"],
      ["historial", "Rasantes anteriores", "Superficies anteriores translucidas en la vista Fases"],
      ["dique", "Dique impermeabilizado", "El jarillón de lleno que retiene los residuos y cierra el vaso por abajo"],
      ["jarillon", "Jarillón (talud 1:2)", "Terraplén de cierre: corona 4 m y talud 1:2 hacia afuera, en los 3 vasos"],
      ["chimeneas", "Chimeneas de biogás", "Modulos reales de 2 m; jaula con trazo grafico de 1,25 px, no diametro del alambre"],
      ["vaso1", "Vaso 1", "Etapas 2 y 3 según el plano de vaso 1"],
      ["vaso2", "Vaso 2", "Etapas 1, 2 y 3 según el plano de vaso 2"],
      ["vaso3", "Vaso 3", "Etapas 1 a 4 según el plano de vaso 3"],
      ["eje", "Eje de replanteo", "Alineamiento con abscisas del plano"],
    ],
  },
  {
    title: "Capas técnicas",
    items: [
      ["geosinteticos", "Geosintéticos", "Geotextil NT 2000 / geomembrana 60 mils / geotextil NT 2000"],
      ["filtros", "Filtros de lixiviados", "Zanja drenante de 0,78 m con bolo, malla y tubería PEAD perforada"],
      ["tuberias", "Tuberías PEAD", 'Tubería de lixiviados de 6" y 10", con diámetro real en el filtro'],
      ["pozos", "Pozos / MH", "Cámaras de salida de lixiviado (tamaño visual 6 m); clic muestra el nombre"],
      ["aguasLluvias", "Manejo de aguas lluvias", "Drenaje perimetral de aguas lluvias"],
      ["drenajes", "Drenajes y cunetas", "Cunetas y desagües del levantamiento"],
    ],
  },
  {
    title: "Obras y superficies de proyecto",
    items: [
      ["vias", "Vías y accesos", "Corredores viales y área de minería"],
      ["estabilizacion", "Obras de estabilización", "Hombros y patas de talud, piso duro"],
      ["alcantarillas", "Alcantarillas", "Trazados de alcantarillas del expediente"],
      ["curvasProyecto", "Contorno y curvas de proyecto", "Límite de excavación y llenado tal como lo dibuja la planta"],
      ["superficieObras", "Obras iniciales", "Explanación de la Fase 1 Etapa 1, con sus cotas rotuladas"],
      ["superficieLlenado", "Llenado final de los vasos", "Ultima rasante documentada de cada vaso; no relleno del predio completo"],
      ["piezometros", "Piezómetros", "Instrumentación geotécnica"],
      ["boxCulvert", "Box culvert del relleno", "Bajo los vasos 2 y 3, por su vaguada (ubicación indicada; sección 1,50 × 1,50 m de las láminas de 2022)"],
    ],
  },
  {
    title: "Referencia",
    items: [
      ["planoReferencia", "Plano técnico de referencia", "Proyecta el PDF sobre el terreno"],
      ["dron", "Vuelo de dron", "Estado actual del sitio, sobre el modelo del proyecto"],
      ["ortofoto", "Ortofoto del dron", "Imagen aérea real drapeada sobre el terreno; muestra qué parte del relleno se representa"],
    ],
  },
];

const VIEWS = [
  ["general", "Vista general"],
  ["planta", "Planta"],
  ["3d", "3D"],
  ["perfil", "Perfil"],
  ["fases", "Fases"],
  ["construccion", "Construcción"],
  ["dique", "Dique"],
  ["tecnicas", "Capas técnicas"],
];

/* Secuencia de obra: cada paso enciende las capas reales que corresponden a
   ese momento de la construcción y fija la etapa de llenado. Las capas salen
   todas de los planos; no se inventa geometría, solo se orquesta qué se ve. */
const CONSTRUCCION = [
  { label: "1 · Sitio inicial", sub: "terreno natural",
    on: { topografia: true, planimetria: true }, phase: 1 },
  { label: "2 · Obras iniciales", sub: "explanación, vías y accesos",
    on: { topografia: true, superficieObras: true, vias: true, estabilizacion: true,
          curvasProyecto: true, drenajes: true }, phase: 1 },
  { label: "3 · Excavación", sub: "corte de vasos y jarillón",
    on: { topografia: true, movimiento: true, dique: true, jarillon: true, curvasProyecto: true,
          vias: true }, phase: 1 },
  { label: "4 · Impermeabilización", sub: "geosintéticos y filtros",
    on: { topografia: true, movimiento: true, dique: true, jarillon: true, geosinteticos: true,
          filtros: true, tuberias: true, pozos: true }, phase: 1 },
  { label: "5 · Llenado etapa 1", sub: "residuos + chimeneas",
    on: { topografia: true, movimiento: true, dique: true, jarillon: true, chimeneas: true,
          filtros: true, tuberias: true, pozos: true }, phase: 1 },
  { label: "6 · Llenado etapa 2", sub: "recrecimiento",
    on: { topografia: true, movimiento: true, dique: true, jarillon: true, chimeneas: true }, phase: 2 },
  { label: "7 · Llenado etapa 3", sub: "recrecimiento",
    on: { topografia: true, movimiento: true, dique: true, jarillon: true, chimeneas: true }, phase: 3 },
  { label: "8 · Llenado etapa 4", sub: "cota final de corona",
    on: { topografia: true, movimiento: true, dique: true, jarillon: true, chimeneas: true }, phase: 4 },
];
/* capas que la secuencia controla: se apagan salvo las que el paso encienda */
const CONSTRUCCION_KEYS = ["topografia","planimetria","curvas","movimiento","dique",
  "chimeneas","geosinteticos","filtros","tuberias","pozos","aguasLluvias","drenajes","vias",
  "estabilizacion","curvasProyecto","superficieObras","superficieLlenado","boxCulvert","jarillon"];

export function buildUi(ctx) {
  const { state, model, site, viewer } = ctx;

  document.querySelector("#project-title").textContent = model.meta.proyecto;
  document.querySelector("#project-crs").textContent = model.meta.crs;

  buildLayerControls(ctx);
  buildViewButtons(ctx);
  buildPhaseControls(ctx);
  buildConstructionControl(ctx);
  buildPlanPicker(ctx);
  buildExaggeration(ctx);
  buildSectionControl(ctx);
  buildDroneControl(ctx);
  buildOrthophotoControl(ctx);
  buildLegend(ctx);
  buildInspector(ctx);
  // La ficha fijable y tactil se instala junto al sistema de presentacion.
  buildDrainageInspection(ctx);

  document.querySelector("#stat-area").textContent =
    `${Math.round(site.width)} x ${Math.round(site.depth)} m`;
  document.querySelector("#stat-elev").textContent =
    `${site.minZ.toFixed(0)} - ${site.maxZ.toFixed(0)} m`;
}

function buildLayerControls(ctx) {
  const host = document.querySelector("#layer-controls");
  host.innerHTML = "";
  for (const group of LAYER_GROUPS) {
    const section = document.createElement("section");
    section.className = "layer-group";
    section.innerHTML = `<h3>${group.title}</h3>`;
    for (const [key, label, hint] of group.items) {
      const row = document.createElement("label");
      row.className = "layer-toggle";
      row.title = hint;
      row.innerHTML = `
        <input type="checkbox" data-layer="${key}" ${ctx.state.layers[key] ? "checked" : ""} />
        <span class="layer-name">${label}</span>
        <span class="layer-hint">${hint}</span>`;
      row.querySelector("input").addEventListener("change", (event) => {
        ctx.state.layers[key] = event.target.checked;
        ctx.applyLayers();
        if (key === "planoReferencia" && event.target.checked) ctx.setPlan(ctx.state.planKey);
      });
      section.append(row);
    }
    host.append(section);
  }
}

function buildViewButtons(ctx) {
  const host = document.querySelector("#view-modes");
  host.innerHTML = "";
  for (const [key, label] of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "view-button";
    button.dataset.view = key;
    button.textContent = label;
    button.addEventListener("click", () => {
      host.querySelectorAll(".view-button").forEach((b) => b.classList.remove("is-active"));
      button.classList.add("is-active");
      if (ctx.restoreInspection) { ctx.restoreInspection(); ctx.restoreInspection = null; }
      ctx.state.component = key === "dique" ? "dique" : "conjunto";
      ctx.state.view = key;
      applyViewPreset(ctx, key);
      ctx.frame(key);
      ctx.syncComponents?.();
      if (ctx.state.basin !== "todos" && key !== "perfil") ctx.focusComponent?.();
    });
    host.append(button);
  }
  host.querySelector('[data-view="general"]').classList.add("is-active");
}

/** Cada modo enciende las capas que tienen sentido para ese modo. */
function applyViewPreset(ctx, key) {
  const L = ctx.state.layers;
  const set = (patch) => {
    Object.assign(L, patch);
    document.querySelectorAll("#layer-controls input[data-layer]").forEach((input) => {
      input.checked = Boolean(L[input.dataset.layer]);
    });
    ctx.applyLayers();
  };
  document.body.classList.toggle("is-construccion", key === "construccion");
  if (key === "construccion") { setConstructionStep(ctx, 0); return; }
  if (["general", "3d", "planta", "fases", "perfil"].includes(key)) set({
    topografia: true, movimiento: true, dique: true, geosinteticos: false,
    curvas: false, planimetria: false, rotulos: true,
  });
  if (key === "planta") set({ topografia: true, curvas: true, planimetria: true });
  if (key === "fases") set({ movimiento: true, historial: true, geosinteticos: false, curvas: false });
  if (key === "tecnicas")
    set({
      geosinteticos: true,
      filtros: true,
      tuberias: true,
      pozos: true,
      aguasLluvias: true,
      drenajes: true,
      movimiento: true,
      curvas: false,
    });
  if (key === "perfil") set({ curvas: false, planimetria: false, movimiento: true });
  if (key === "dique") {
    // el dique es obra de la primera etapa de cada vaso
    ctx.state.phase = 1;
    document.querySelectorAll(".phase-button").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.phase === "1")
    );
    ctx.applyPhase();
    set({
      dique: true,
      movimiento: false,
      geosinteticos: false,
      curvas: false,
      planimetria: false,
      vias: false,
      rotulos: false,
      filtros: false, tuberias: false, pozos: false, aguasLluvias: false, drenajes: false,
      chimeneas: false, estabilizacion: false, alcantarillas: false,
    });
  }
}

function buildPhaseControls(ctx) {
  const host = document.querySelector("#phase-control");
  host.innerHTML = "";
  const maxPhase = Math.max(
    3,
    ...Object.values(ctx.model.vasos).flatMap((v) =>
      v.fases.map((f) => Number(f.split("/")[1]))
    )
  );
  host.style.gridTemplateColumns = `repeat(${maxPhase}, 1fr)`;
  for (let n = 1; n <= maxPhase; n += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "phase-button";
    button.dataset.phase = String(n);
    button.innerHTML = `<span>Fase ${n}</span>`;
    button.addEventListener("click", () => {
      ctx.state.phase = n;
      ctx.state.layers.superficieLlenado = false;
      ctx.applyLayers();
      host.querySelectorAll(".phase-button").forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.phase) === n)
      );
    });
    host.append(button);
  }
  host.querySelector(`[data-phase="${ctx.state.phase}"]`).classList.add("is-active");
}

function buildConstructionControl(ctx) {
  const host = document.querySelector("#construccion-steps");
  if (!host) return;
  host.innerHTML = "";
  CONSTRUCCION.forEach((step, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "phase-button";
    b.dataset.step = String(i);
    b.innerHTML = `<span>${step.label}</span><small>${step.sub}</small>`;
    b.addEventListener("click", () => setConstructionStep(ctx, i));
    host.append(b);
  });
}

function setConstructionStep(ctx, i) {
  const step = CONSTRUCCION[i];
  const L = ctx.state.layers;
  for (const k of CONSTRUCCION_KEYS) L[k] = false;
  Object.assign(L, step.on);
  ctx.state.phase = step.phase;
  document.querySelectorAll("#construccion-steps .phase-button").forEach((b) =>
    b.classList.toggle("is-active", Number(b.dataset.step) === i));
  document.querySelectorAll("#layer-controls input[data-layer]").forEach((input) => {
    input.checked = Boolean(L[input.dataset.layer]);
  });
  document.querySelectorAll(".phase-button[data-phase]").forEach((b) =>
    b.classList.toggle("is-active", Number(b.dataset.phase) === step.phase));
  ctx.applyLayers();
  ctx.applyPhase();
}

function buildPlanPicker(ctx) {
  const host = document.querySelector("#plan-list");
  host.innerHTML = "";
  for (const [key, plan] of Object.entries(ctx.model.meta.planos)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-button";
    button.dataset.plan = key;
    button.innerHTML = `
      <strong>${plan.tituloCorto || key}</strong>
      <small>${plan.escala} &middot; ${plan.categoria || ""}</small>`;
    button.addEventListener("click", async () => {
      host.querySelectorAll(".plan-button").forEach((b) => b.classList.remove("is-active"));
      button.classList.add("is-active");
      ctx.state.layers.planoReferencia = true;
      const input = document.querySelector('input[data-layer="planoReferencia"]');
      if (input) input.checked = true;
      ctx.applyLayers();
      await ctx.setPlan(key);
      showPlanMeta(plan);
    });
    host.append(button);
  }
  const first = host.querySelector(`[data-plan="${ctx.state.planKey}"]`);
  if (first) first.classList.add("is-active");
  showPlanMeta(ctx.model.meta.planos[ctx.state.planKey]);

  function showPlanMeta(plan) {
    if (!plan) return;
    document.querySelector("#plan-title").textContent = plan.titulo;
    document.querySelector("#plan-file").textContent = plan.archivo;
    document.querySelector("#plan-scale").textContent = plan.escala;
    const g = plan.georreferencia;
    document.querySelector("#plan-georef").textContent =
      g.residualM === null ? g.source : `${g.source} (residuo ${g.residualM} m)`;
    const notes = document.querySelector("#plan-notes");
    notes.innerHTML = "";
    for (const note of plan.notas || []) {
      const li = document.createElement("li");
      li.textContent = note;
      notes.append(li);
    }
  }
}

function buildExaggeration(ctx) {
  const input = document.querySelector("#exaggeration");
  const output = document.querySelector("#exaggeration-value");
  input.addEventListener("input", () => {
    const value = Number(input.value) / 10;
    output.textContent = `${value.toFixed(1)}x`;
    ctx.setExaggeration(value);
  });
}

function buildSectionControl(ctx) {
  const select = document.querySelector("#section-basin");
  const input = document.querySelector("#section-station");
  const output = document.querySelector("#section-value");
  const label = (v) => `${Math.floor(v / 1000)}+${String(Math.round(v % 1000)).padStart(3, "0")}`;

  select.innerHTML = "";
  for (const key of Object.keys(ctx.model.vasos)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key.replace("vaso", "Vaso ");
    option.selected = key === ctx.cut.vasoKey;
    select.append(option);
  }

  const sync = () => {
    const vaso = ctx.model.vasos[ctx.cut.vasoKey];
    input.max = String(Math.floor(vaso.eje.longitud));
    input.value = String(Math.round(ctx.cut.station));
    output.textContent = label(Number(input.value));
    drawSectionSvg(ctx);
  };
  sync();

  input.addEventListener("input", () => {
    const station = Number(input.value);
    output.textContent = label(station);
    ctx.setCutStation(station);
    drawSectionSvg(ctx);
  });
  select.addEventListener("change", () => {
    ctx.setCutVaso(select.value);
    sync();
  });
  document.addEventListener("visor:phase", () => drawSectionSvg(ctx));
  document.addEventListener("visor:section", () => drawSectionSvg(ctx));
}

function buildDrainageInspection(ctx) {
  const panel = document.createElement("section");
  panel.id = "channel-panel";
  panel.className = "panel";
  panel.innerHTML = `<div class="panel-head"><h2>Detalle de canales</h2></div>
    <label for="channel-reach">Tramo proyectado</label>
    <select id="channel-reach" style="width:100%;margin:8px 0;padding:8px;background:#18272c;color:#edf4f3;border:1px solid #496266;border-radius:4px"></select>
    <button type="button" id="inspect-channel" class="plan-button">Inspeccionar canal aislado</button>
    <details style="margin-top:12px"><summary>Seccion original del plano</summary>
      <a href="assets/detalle-canal.png" target="_blank" rel="noopener"><img src="assets/detalle-canal.png" alt="Detalle del vaso 2: cuneta en tierra con fondo de 50 cm y profundidad de 50 cm" style="width:100%;margin-top:8px"></a>
    </details><p class="panel-note">${ctx.notes.drainage}</p>`;
  document.querySelector("#plan-list").closest(".panel").before(panel);
  const select = panel.querySelector("select");
  const channels = ctx.groups.networks.userData.byKey.get("aguasLluvias");
  channels.children.forEach((channel, i) => {
    if (!channel.userData.inspectionPoints?.length) return;
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `Canal ${i + 1}`;
    select.append(option);
  });
  panel.querySelector("button").addEventListener("click", () => {
    ctx.state.basin = "todos";
    document.querySelector('[data-view="tecnicas"]').click();
    const savedLayers = { ...ctx.state.layers };
    ctx.restoreInspection = () => {
      Object.assign(ctx.state.layers, savedLayers);
      document.querySelectorAll("#layer-controls input[data-layer]").forEach(input => {
        input.checked = Boolean(ctx.state.layers[input.dataset.layer]);
      });
      document.querySelector("#legend").style.display = "";
      ctx.applyLayers();
    };
    document.querySelector("#legend").style.display = "none";
    Object.assign(ctx.state.layers, { curvas: false, planimetria: false, puntos: false,
      eje: false, rotulos: false, aguasLluvias: true, dron: false, planoReferencia: false,
      geosinteticos: false, chimeneas: false, filtros: false, tuberias: false, pozos: false,
      drenajes: false, vias: false, estabilizacion: false, topografia: false,
      movimiento: false, dique: false, superficieObras: false, superficieLlenado: false });
    document.querySelectorAll("#layer-controls input[data-layer]").forEach((input) => {
      input.checked = Boolean(ctx.state.layers[input.dataset.layer]);
    });
    ctx.applyLayers();
    const points = channels.children[Number(select.value)].userData.inspectionPoints;
    const middle = Math.floor(points.length / 2);
    const p = points[middle].clone();
    p.y *= ctx.site.exaggeration;
    const tangent = points[Math.min(middle + 2, points.length - 1)].clone()
      .sub(points[Math.max(0, middle - 2)]).setY(0).normalize();
    const side = new THREE.Vector3(tangent.z, 0, -tangent.x);
    const eye = p.clone().addScaledVector(side, 7).addScaledVector(tangent, -8);
    eye.y += 12;
    ctx.viewer.flyTo(eye.toArray(), p.clone().add(new THREE.Vector3(0, 0.3, 0)).toArray());
  });
}

function sectionProfileAt(profile, offset) {
  if (!profile || !profile.length) return null;
  if (offset <= profile[0][0]) return profile[0][1];
  const last = profile[profile.length - 1];
  if (offset >= last[0]) return last[1];
  let lo = 0;
  let hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid][0] <= offset) lo = mid;
    else hi = mid;
  }
  const [o0, z0] = profile[lo];
  const [o1, z1] = profile[hi];
  return z0 + ((z1 - z0) * (offset - o0)) / (o1 - o0 || 1e-6);
}

function sectionActiveSpan(upper, lower) {
  const offsets = new Set();
  for (const [o] of upper) offsets.add(o);
  for (const [o] of lower) offsets.add(o);
  let lo = null;
  let hi = null;
  for (const o of [...offsets].sort((a, b) => a - b)) {
    if (Math.abs(sectionProfileAt(upper, o) - sectionProfileAt(lower, o)) > 0.03) {
      if (lo === null) lo = o;
      hi = o;
    }
  }
  return lo === null ? null : [lo, hi];
}

function drawSectionSvg(ctx) {
  const svg = document.querySelector("#section-drawing");
  const data = ctx.cut.sectionData();
  if (!svg || !data || !data.terrain.length) return;
  const width = 292;
  const height = 184;
  const pad = { l: 34, r: 10, t: 14, b: 28 };
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  const profiles = [data.terrain, ...Object.values(data.surfaces)].filter(Boolean);
  const offsets = profiles.flatMap((p) => p.map(([o]) => o));
  const elevs = profiles.flatMap((p) => p.map(([, z]) => z));
  const xMin = Math.floor(Math.min(...offsets) / 10) * 10;
  const xMax = Math.ceil(Math.max(...offsets) / 10) * 10;
  const yMin = Math.floor(Math.min(...elevs) / 5) * 5;
  const yMax = Math.ceil(Math.max(...elevs) / 5) * 5;
  const x = (o) => pad.l + ((o - xMin) / Math.max(xMax - xMin, 1)) * (width - pad.l - pad.r);
  const y = (z) => height - pad.b - ((z - yMin) / Math.max(yMax - yMin, 1)) * (height - pad.t - pad.b);
  const el = (name, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  const path = (profile) => profile.map(([o, z], i) => `${i ? "L" : "M"}${x(o).toFixed(1)},${y(z).toFixed(1)}`).join(" ");

  for (let zc = yMin; zc <= yMax; zc += 5) {
    el("line", { x1: pad.l, y1: y(zc), x2: width - pad.r, y2: y(zc), class: "section-grid" });
    const text = el("text", { x: 4, y: y(zc) + 3, class: "section-axis" });
    text.textContent = zc;
  }
  for (let oc = Math.ceil(xMin / 20) * 20; oc <= xMax; oc += 20) {
    el("line", { x1: x(oc), y1: pad.t, x2: x(oc), y2: height - pad.b, class: "section-grid section-grid-v" });
  }

  for (const phase of data.phases) {
    const n = Number(phase.split("/")[1]);
    if (n > ctx.cut.phaseLimit) continue;
    const upper = data.surfaces[phase];
    const rank = data.phases.indexOf(phase);
    const lower = rank > 0 && data.surfaces[data.phases[rank - 1]]
      ? data.surfaces[data.phases[rank - 1]]
      : data.terrain;
    if (!upper || !lower) continue;
    const span = sectionActiveSpan(upper, lower);
    if (!span) continue;
    const marks = new Set(span);
    for (const [o] of upper) if (o > span[0] && o < span[1]) marks.add(o);
    for (const [o] of lower) if (o > span[0] && o < span[1]) marks.add(o);
    const sorted = [...marks].sort((a, b) => a - b);
    const d = [
      ...sorted.map((o, i) => `${i ? "L" : "M"}${x(o).toFixed(1)},${y(sectionProfileAt(upper, o)).toFixed(1)}`),
      ...sorted.slice().reverse().map((o) => `L${x(o).toFixed(1)},${y(sectionProfileAt(lower, o)).toFixed(1)}`),
      "Z",
    ].join(" ");
    const color = `#${(ctx.phaseStyle[phase]?.color || 0x8f9aa3).toString(16).padStart(6, "0")}`;
    el("path", { d, fill: color, class: "section-fill" });
  }

  el("path", { d: path(data.terrain), class: "section-terrain" });
  const first = data.phases.find((phase) => data.surfaces[phase]);
  if (first) el("path", { d: path(data.surfaces[first]), class: "section-lining" });

  const base = el("text", { x: pad.l, y: height - 8, class: "section-caption" });
  base.textContent =
    `${data.vasoKey.replace("vaso", "Vaso ")} · abscisa ${Math.floor(data.station / 1000)}+${String(Math.round(data.station % 1000)).padStart(3, "0")}`;
  const legend = el("g", { class: "section-mini-legend" });
  const items = [
    ["Terreno natural", "terrain"],
    ["Rasante/geosintéticos", "lining"],
    ["Etapas visibles", "fill"],
  ];
  items.forEach(([label, kind], i) => {
    const x0 = width - 142;
    const y0 = 18 + i * 15;
    const swatch = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    swatch.setAttribute("x", x0);
    swatch.setAttribute("y", y0 - 8);
    swatch.setAttribute("width", 10);
    swatch.setAttribute("height", 6);
    swatch.setAttribute("class", `section-key-${kind}`);
    legend.append(swatch);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x0 + 15);
    text.setAttribute("y", y0 - 2);
    text.textContent = label;
    legend.append(text);
  });
}

function buildDroneControl(ctx) {
  const panel = document.querySelector("#drone-panel");
  const input = document.querySelector("#drone-opacity");
  const output = document.querySelector("#drone-opacity-value");
  const note = document.querySelector("#drone-note");
  if (!ctx.droneConfig) {
    panel.remove();
    return;
  }
  note.textContent =
    `Vuelo del ${ctx.droneConfig.vuelo}. Situado con la georreferenciación del propio ` +
    `vuelo (${ctx.droneConfig.crsOrigen}); desfase altimétrico medido contra el terreno ` +
    `del proyecto: ${ctx.droneConfig.desfaseVertical} m.`;

  const apply = async () => {
    const value = Number(input.value) / 100;
    output.textContent = `${input.value} %`;
    const built = await ctx.ensureDrone();
    if (built && built.userData.setOpacity) built.userData.setOpacity(value);
  };
  input.addEventListener("input", apply);

  document.addEventListener("visor:dron-visible", (event) => {
    document.body.classList.toggle("has-drone", Boolean(event.detail));
    if (event.detail) apply();
  });
}

function buildOrthophotoControl(ctx) {
  const group = ctx.viewer.groups.get("ortofoto");
  const select = document.querySelector("#ortho-flight");
  const panel = document.querySelector("#ortho-panel");
  const flights = group && group.userData ? group.userData.flights : [];
  if (!select || !flights || !flights.length) {
    if (panel) panel.remove();
    return;
  }
  select.innerHTML = "";
  for (const f of flights) {
    const opt = document.createElement("option");
    opt.value = f.key;
    opt.textContent = f.name;
    select.append(opt);
  }
  if (flights.length > 1) {
    const both = document.createElement("option");
    both.value = "ambas";
    both.textContent = "Ambas a la vez";
    select.append(both);
  }
  // arranca en el vuelo mas reciente (el que dejo activo la capa)
  select.value = group.userData.current();
  select.addEventListener("change", () => group.userData.setFlight(select.value));

  document.addEventListener("visor:ortofoto-visible", (event) => {
    document.body.classList.toggle("has-ortho", Boolean(event.detail));
  });
}

function buildLegend(ctx) {
  const host = document.querySelector("#legend");
  host.innerHTML = "";

  // una columna por vaso, para que la leyenda no crezca a lo alto
  const byVaso = new Map();
  for (const [vkey, vaso] of Object.entries(ctx.model.vasos)) {
    byVaso.set(vkey, vaso.fases);
  }

  for (const [vkey, phases] of byVaso) {
    const block = document.createElement("div");
    block.className = "legend-block";
    block.innerHTML = `<h4>${vkey.replace("vaso", "Vaso ")}</h4>`;
    for (const phase of phases) {
      const style = ctx.phaseStyle[phase];
      if (!style) continue;
      const row = document.createElement("div");
      row.className = "legend-row";
      const hex = style.color.toString(16).padStart(6, "0");
      row.innerHTML = `<i style="background:#${hex}"></i><span>Etapa ${phase.split("/")[1]}</span>`;
      block.append(row);
    }
    host.append(block);
  }

  const obra = document.createElement("div");
  obra.className = "legend-block";
  obra.innerHTML = "<h4>Obra</h4>";
  for (const [color, label] of [
    ["#cf8655", "Dique inicial (jarillon)"],
    ["#8f9aa3", "Excavación (corte)"],
    ["#263c48", "Geomembrana PEAD"],
    ["#e8c377", "Geotextil NT 2000"],
  ]) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<i style="background:${color}"></i><span>${label}</span>`;
    obra.append(row);
  }
  host.append(obra);

  const leachate = document.createElement("div");
  leachate.className = "legend-block";
  leachate.innerHTML = "<h4>Lixiviados</h4>";
  const filterRow = document.createElement("div");
  filterRow.className = "legend-row";
  filterRow.innerHTML = '<i class="legend-filter"></i><span>Filtro: bolo + malla · h 0,78 m</span>';
  leachate.append(filterRow);
  for (const key of ["tuberia6", "tuberia10"]) {
    const net = ctx.model.redes[key];
    if (!net) continue;
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<i style="background:${net.color}"></i><span>${net.label} · diam. ${(net.radius * 2).toFixed(3)} m</span>`;
    leachate.append(row);
  }
  const flow = document.createElement("div");
  flow.className = "legend-row";
  flow.innerHTML = '<i class="legend-flow"></i><span>Flechas: flujo por gravedad hacia P2-P6</span>';
  leachate.append(flow);
  host.append(leachate);

  const water = document.createElement("div");
  water.className = "legend-block";
  // el box de ocupacion de cauce entra en el bloque de aguas cuando esta visible
  if (ctx.state.layers.boxCulvert && ctx.viewer.groups.get("boxCulvert") && !ctx.viewer.groups.get("boxCulvert").userData.missing) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      '<i style="background:#aeb4b2"></i><span>Box culvert 1,50 × 1,50 m · bajo vasos 2 y 3 (ubicación indicada)</span>';
    water.append(row);
  }
  water.innerHTML = "<h4>Aguas lluvias</h4>";
  for (const key of ["aguasLluvias", "cuneta"]) {
    const net = ctx.model.redes[key];
    if (!net) continue;
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<i style="background:${key === "aguasLluvias" ? "#b4a386" : net.color}"></i><span>${key === "aguasLluvias" ? "Canal abierto de tierra · 0,50 m de fondo" : "Cuneta existente · traza"}</span>`;
    water.append(row);
  }
  const stormFlow = document.createElement("div");
  stormFlow.className = "legend-row";
  stormFlow.innerHTML = '<span>Canales: alzado esquematico +0,54 m</span>';
  water.append(stormFlow);
  host.append(water);

  const infrastructure = document.createElement("div");
  infrastructure.className = "legend-block";
  infrastructure.innerHTML = "<h4>Infraestructura</h4>";
  for (const [color, label] of [
    ["#c8aa76", "Vias y accesos"],
    ["#57d5db", "Alcantarillas · simbolo"],
    ["#9a7b5a", "Obras de estabilizacion"],
  ]) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<i style="background:${color}"></i><span>${label}</span>`;
    infrastructure.append(row);
  }
  host.append(infrastructure);
}

function buildInspector(ctx) {
  const design = ctx.model.diseno;
  const host = document.querySelector("#design-params");
  host.innerHTML = "";
  const rows = [
    ["Taludes", design.taludes.valor],
    ["Fondo de vaso", design.fondoVaso.valor],
    ["Capas compactadas", design.capasCompactadas.valor],
    ["Dique", design.dique.valor],
    ["Geosintéticos", design.geosinteticos.capas.join(" + ")],
    ["Zanja de anclaje", design.geosinteticos.zanjaAnclaje],
    ["Filtros", `${design.filtros.tuberia}; ${design.filtros.material}; altura ${design.filtros.altura}`],
    ["Pendiente de filtros", design.filtros.pendiente],
  ];
  if (design.chimeneas) {
    rows.push([
      "Chimeneas",
      `${design.chimeneas.cerramiento}; ${design.chimeneas.relleno}`,
    ]);
  }
  for (const [label, value] of rows) {
    const div = document.createElement("div");
    div.className = "param";
    div.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
    host.append(div);
  }

  buildSpecs(design.especificaciones);
  buildTechnicalAudit(ctx);

  const pozos = document.querySelector("#pozos-list");
  pozos.innerHTML = "";
  for (const p of ctx.model.puntos.pozos || []) {
    const li = document.createElement("li");
    const cota = p.elev === null || p.elev === undefined ? "sin cota publicada" : `fondo ${p.elev.toFixed(2)} m`;
    li.innerHTML = `<strong>${p.id}</strong> ${p.vaso.replace("vaso", "vaso ")} &middot; ${cota}`;
    pozos.append(li);
  }

  document.querySelector("#lining-note").textContent = ctx.notes.lining;
  document.querySelector("#filter-note").textContent = ctx.notes.filters;
  document.querySelector("#drainage-note").textContent = ctx.notes.drainage;
  document.querySelector("#operation-note").textContent = ctx.notes.operation;
  document.querySelector("#model-note").textContent = ctx.model.meta.advertencia;
}

function buildTechnicalAudit(ctx) {
  const host = document.querySelector("#technical-audit");
  if (!host) return;
  host.innerHTML = "";
  const grid = ctx.terrain.grid;
  const interpolated = grid.interpolated
    ? grid.interpolated.filter(Boolean).length
    : 0;
  const total = grid.z.filter((z) => z !== null).length || 1;
  const rows = [
    ["Terreno", `${ctx.terrain.contours.length} curvas · paso ${grid.step} m · cotas ${ctx.site.minZ.toFixed(0)}-${ctx.site.maxZ.toFixed(0)} m`],
    ["Zona interpolada", `${Math.round((interpolated / total) * 100)} % del MDT, marcada en gris y con borde claro`],
    ["Secciones", Object.entries(ctx.model.vasos).map(([k, v]) => `${k.replace("vaso", "V")} ${v.secciones.length}`).join(" · ")],
    ["Movimiento", "Rasantes y cuerpos reconstruidos desde perfiles; tablas verificadas por herramientas"],
    ["Hidráulica", "Lixiviados y aguas lluvias separados por capa, material, leyenda y sentido de flujo"],
  ];
  const piez = ctx.groups.piezometers?.userData;
  if (piez && piez.skippedOutsideTerrain) {
    rows.push([
      "Instrumentación",
      `${piez.skippedOutsideTerrain} de ${piez.total} piezómetros caen fuera del MDT y no se dibujan en 3D`,
    ]);
  }
  const recordAudit = ctx.topographyAudit?.recordContoursVsGrid;
  if (recordAudit?.status === "external_source_conflict") {
    const best = recordAudit.best;
    const zone = recordAudit.conflictZone;
    const where = zone
      ? ` zona E ${Math.round(zone.bbox[0])}-${Math.round(zone.bbox[2])}, N ${Math.round(zone.bbox[1])}-${Math.round(zone.bbox[3])}`
      : "";
    rows.push([
      "Curvas record",
      `Conflicto externo: P95 ${best.absP95.toFixed(1)} m, máximo ${best.absMax.toFixed(1)} m.${where}. No se mezclan con el MDT verificado del plano base.`,
    ]);
  }
  for (const [label, value] of rows) {
    const div = document.createElement("div");
    div.className = "param";
    div.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
    host.append(div);
  }
}

/**
 * Especificaciones tecnicas del expediente, citadas por su numero de item.
 *
 * Son las que respaldan materiales y dimensiones que los planos no rotulan,
 * como la seccion de las chimeneas. Se listan plegadas para que el panel siga
 * siendo legible y se pueda abrir el item que interese.
 */
function buildSpecs(specs) {
  const host = document.querySelector("#specs-list");
  const source = document.querySelector("#specs-source");
  if (!host) return;
  host.innerHTML = "";
  if (!specs) {
    if (source) source.textContent = "";
    return;
  }
  if (source) source.textContent = `${specs.documento} · ${specs.fuente}`;

  for (const item of specs.items || []) {
    const details = document.createElement("details");
    details.className = "spec";
    details.id = `spec-${item.item.replaceAll(" ", "-")}`;
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="spec-item">${item.item}</span> ${item.titulo}`;
    details.append(summary);

    const list = document.createElement("ul");
    for (const dato of item.datos || []) {
      const li = document.createElement("li");
      li.textContent = dato;
      list.append(li);
    }
    details.append(list);

    if (item.nota) {
      const note = document.createElement("p");
      note.className = "spec-note";
      note.textContent = item.nota;
      details.append(note);
    }
    host.append(details);
  }
}

/** Lectura de cota y de elemento bajo el cursor. */
function buildPicking(ctx) {
  const { viewer, site } = ctx;
  const readout = document.querySelector("#readout");
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pending = false;
  let pinned = false;   // al hacer clic, el nombre queda fijo

  const shown = (object) => {
    for (let n = object; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  const resolveHit = (event) => {
    const rect = viewer.canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewer.camera);
    const hits = raycaster.intersectObjects(viewer.scene.children, true);
    return hits.find((h) => {
      if (!h.object.userData.pickable || !shown(h.object)) return false;
      if (viewer.renderer.clippingPlanes.some((p) => p.distanceToPoint(h.point) < 0)) return false;
      const material = Array.isArray(h.object.material)
        ? h.object.material[h.face?.materialIndex || 0] : h.object.material;
      const planes = material?.clippingPlanes || [];
      const clipped = (p) => p.distanceToPoint(h.point) < 0;
      return !planes.length || !(material.clipIntersection ? planes.every(clipped) : planes.some(clipped));
    });
  };
  const render = (hit, pin) => {
    const p = hit.point;
    const east = site.east0 + p.x;
    const north = site.north0 - p.z;
    const elev = site.base + p.y / site.exaggeration;
    const note = hit.object.userData.visualNote;
    readout.classList.add("is-visible");
    readout.classList.toggle("is-pinned", pin);
    readout.innerHTML = `
      <strong>${hit.object.userData.pickable}</strong>
      <span>E ${east.toFixed(1)} &nbsp; N ${north.toFixed(1)}</span>
      <span>Cota ${elev.toFixed(2)} m</span>
      ${note ? `<span class="readout-note">${note}</span>` : ""}
      ${pin ? `<span class="readout-note">clic en vacío para cerrar</span>` : ""}`;
  };

  viewer.canvas.addEventListener("pointermove", (event) => {
    if (pinned) return;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const hit = resolveHit(event);
      if (!hit) { readout.classList.remove("is-visible"); return; }
      render(hit, false);
    });
  });

  // clic: fija el nombre del elemento; clic en vacío lo cierra
  viewer.canvas.addEventListener("click", (event) => {
    const hit = resolveHit(event);
    if (!hit) { pinned = false; readout.classList.remove("is-visible", "is-pinned"); return; }
    pinned = true;
    render(hit, true);
  });

  viewer.canvas.addEventListener("pointerleave", () => {
    if (!pinned) readout.classList.remove("is-visible");
  });
}
