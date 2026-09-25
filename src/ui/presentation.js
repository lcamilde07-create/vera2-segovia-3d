import * as THREE from "three";
import { PALETTE as P, cssColor, earthColor, networkColor } from "../core/palette.js";
import { buildTerrain } from "../layers/terrain.js";

const TOUR = [
  ["El sitio", "Lote de 514 × 446 m en Segovia (Antioquia), entre las cotas 481 y 549 m. Todo lo que ves está derivado de los planos del expediente y verificado contra ellos.", "general", null, 1],
  ["La excavación", "Se excavan tres vasos en la ladera, con taludes 1:2 y fondo con pendiente del 2 al 3 %. El material excavado no se bota: se reutiliza en la obra.", "tecnicas", "excavacion", 1],
  ["El dique", "Un jarillón conformado con el propio material de excavación cierra cada vaso por abajo y retiene los residuos.", "dique", "dique", 1],
  ["La impermeabilización", "El fondo y los taludes se sellan con un sándwich: geotextil NT2000, geomembrana de polietileno de 1,5 mm y otro geotextil, anclado en una zanja perimetral de 50 × 50 cm. Al fondo, filtros de piedra con tubería perforada recogen los lixiviados.", "tecnicas", "geomembrana", 1],
  ["El llenado por fases", "El vaso se llena por etapas de unos 10 m hasta las cotas de corona. Las chimeneas de malla galvanizada de 1 × 1 m suben por módulos de 2 m con el relleno, evacuando el biogás.", "fases", null, 4],
  ["El agua", 'Dos aguas separadas: los lixiviados se bombean por tubería de 6" a las lagunas de almacenamiento; las aguas lluvias van por canales en la pata de cada terraza, con pendiente mínima del 0,8 %, hacia los pozos y cunetas.', "tecnicas", null, 1],
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const shown = object => { for (let n = object; n; n = n.parent) if (!n.visible) return false; return true; };

export function buildPresentation(ctx) {
  const { viewer, state, groups, model, site } = ctx;
  const viewport = viewer.canvas.parentElement;
  const legend = document.querySelector("#legend");
  const north = document.createElement("div");
  north.className = "map-reference";
  north.innerHTML = '<span class="north-arrow">↑ N</span><span class="scale-bar"></span><span class="scale-value"></span>';
  viewport.append(north);
  const sheet = document.createElement("section");
  sheet.id = "element-card"; sheet.className = "element-card panel"; sheet.hidden = true;
  sheet.setAttribute("aria-label", "Ficha del elemento");
  document.querySelector(".inspector").prepend(sheet);
  const plans = document.querySelector("#plan-list").closest(".panel");
  const accordion = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "Planos de referencia";
  plans.prepend(accordion); accordion.append(summary);
  for (const node of [...plans.children]) if (node !== accordion) accordion.append(node);
  accordion.querySelector(".panel-head")?.remove();

  let tourIndex = -1, saved = null, pinned = null, selectedMaterial = null;
  let naturalTerrain = null;
  const tour = document.createElement("section"); tour.className = "tour-card panel"; tour.id = "tour-card"; tour.hidden = true;
  tour.innerHTML = '<small id="tour-count"></small><h2></h2><p></p><div><button id="tour-prev" title="Paso anterior">←</button><button id="tour-next" title="Paso siguiente">→</button><button id="tour-close">Salir</button></div>';
  document.querySelector(".inspector").prepend(tour);
  const button = document.createElement("button"); button.className = "view-button"; button.id = "tour-start"; button.textContent = "Recorrido";
  document.querySelector("#view-modes").append(button);
  function chooseComponent(value) {
    const input = document.querySelector("#component-filter"); input.value = value; input.dispatchEvent(new Event("change"));
  }
  function goTour(index) {
    tourIndex = index; const [title, text, mode, component, phase] = TOUR[index];
    state.basin = "todos";
    document.querySelector(`[data-view="${mode}"]`).click();
    if (component) chooseComponent(component);
    state.phase = phase;
    if (index === 0) Object.assign(state.layers, {movimiento:false,dique:false,chimeneas:false,filtros:false,tuberias:false,aguasLluvias:false,drenajes:false,geosinteticos:false,vias:false,estabilizacion:false,alcantarillas:false});
    if (index === 3) Object.assign(state.layers, {filtros:true,tuberias:true});
    if (index === 4) state.layers.chimeneas = true;
    if (index === 5) {
      state.component = "excavacion";
      Object.assign(state.layers, {geosinteticos:false,movimiento:true,dique:false,chimeneas:false,filtros:true,tuberias:true,aguasLluvias:true,drenajes:true,alcantarillas:true});
    }
    ctx.applyLayers(); ctx.syncComponents?.();
    // El recorte de obra no pertenece al estado natural del sitio.
    if (!naturalTerrain && index === 0) {
      naturalTerrain = buildTerrain(ctx.terrain, site);
      naturalTerrain.userData.skirt.visible = false;
      viewer.scene.add(naturalTerrain);
    }
    if (naturalTerrain) naturalTerrain.visible = index === 0;
    viewer.groups.get("topografia").userData.mesh.visible = index !== 0;
    if (component) ctx.focusComponent(); else ctx.frame(mode);
    tour.hidden = false; tour.querySelector("h2").textContent = title; tour.querySelector("p").textContent = text;
    tour.querySelector("small").textContent = `${index + 1} / ${TOUR.length}`;
    tour.querySelector("#tour-prev").disabled = index === 0;
    tour.querySelector("#tour-next").textContent = index === TOUR.length - 1 ? "Terminar" : "→";
  }
  function restore(snapshot) {
    Object.assign(state, snapshot, {layers:{...snapshot.layers}});
    ctx.applyLayers(); ctx.frame(state.view); ctx.syncComponents?.();
    ctx.setExaggeration(snapshot.exaggeration);
  }
  function stopTour() {
    if (naturalTerrain) {
      viewer.scene.remove(naturalTerrain);
      const materials = new Set();
      naturalTerrain.traverse(n => { n.geometry?.dispose(); if(n.material)materials.add(n.material); });
      for(const material of materials){material.map?.dispose();material.dispose();}
      naturalTerrain = null;
    }
    viewer.groups.get("topografia").userData.mesh.visible = true;
    if (saved) restore(saved); saved = null; tourIndex = -1; tour.hidden = true;
  }
  button.onclick = () => { if (tourIndex >= 0) return; saved = {...state,layers:{...state.layers}}; goTour(0); };
  tour.querySelector("#tour-prev").onclick = () => goTour(Math.max(0,tourIndex-1));
  tour.querySelector("#tour-next").onclick = () => tourIndex === 5 ? stopTour() : goTour(tourIndex+1);
  tour.querySelector("#tour-close").onclick = stopTour;

  function clearPin() {
    if (selectedMaterial) { selectedMaterial.object.material = selectedMaterial.original; selectedMaterial.highlight.dispose(); }
    selectedMaterial = null; pinned = null; sheet.hidden = true;
  }
  function specification(object, name) {
    if (/chimenea|biogas/i.test(name)) return "4.10";
    if (/geotextil/i.test(name)) return "4.3";
    if (/geomembrana|zanja.*anclaje/i.test(name)) return "4.4";
    if (/pozo/i.test(name)) return "4.12";
    if (/filtro|tuber/i.test(name)) return "4.5 a 4.8";
    if (/alcantarilla/i.test(name)) return "3.4";
    if (/canal|lluvia/i.test(name)) return "4.11";
    if (/cerco|cerramiento/i.test(name)) return "1.3";
    return null;
  }
  function pin(hit) {
    if (pinned === hit.object) { clearPin(); return; }
    clearPin(); pinned = hit.object;
    const name = pinned.userData.pickable || pinned.userData.label || pinned.name;
    const item = specification(pinned, name);
    const spec = model.diseno.especificaciones.items.find(s => s.item === item);
    const p = hit.point;
    sheet.innerHTML = `<button class="close-card" title="Soltar seleccion">×</button><h2>${escape(name)}</h2><dl><dt>Coordenadas MAGNA-SIRGAS</dt><dd>E ${(site.east0+p.x).toFixed(2)} · N ${(site.north0-p.z).toFixed(2)}</dd><dt>Cota del punto dibujado</dt><dd>${(site.base+p.y/site.exaggeration).toFixed(2)} m</dd></dl>`;
    if (spec) sheet.innerHTML += `<a href="#spec-${item.replaceAll(" ", "-")}">Pliego · ${escape(item)} · ${escape(spec.titulo)}</a><ul>${spec.datos.map(d=>`<li>${escape(d)}</li>`).join("")}</ul><p>${escape(spec.nota || "")}</p>`;
    if (pinned.userData.visualNote) sheet.innerHTML += `<p>${escape(pinned.userData.visualNote)}</p>`;
    if (/cerco|cerramiento/i.test(name)) sheet.innerHTML += '<p>Solo traza: la altura remite a un plano sin ubicacion georreferenciada verificable. No se representa alzado.</p>';
    if (/canal|lluvia/i.test(name)) sheet.innerHTML += `<p>${escape(ctx.notes.drainage)}</p>`;
    if (/filtro/i.test(name)) sheet.innerHTML += `<p>${escape(ctx.notes.filters)}</p>`;
    if (/filtro/i.test(name)) sheet.innerHTML += '<svg viewBox="0 0 240 155" role="img" aria-label="Seccion esquematica del filtro, altura 0,78 metros"><defs><pattern id="stone-section" width="17" height="15" patternUnits="userSpaceOnUse"><rect width="17" height="15" fill="#99998a"/><circle cx="7" cy="7" r="5" fill="#676f67"/></pattern></defs><path d="M30 20H190V130H30Z" fill="url(#stone-section)" stroke="#e3e5df" stroke-width="4"/><circle cx="110" cy="113" r="13" fill="#303e44" stroke="#af7690" stroke-width="3"/><path d="M207 20V130M200 20H214M200 130H214" stroke="#b8c7c6" fill="none"/><text x="220" y="80" fill="#e7eef1" font-size="12" transform="rotate(-90 220 80)">0,78 m</text><text x="30" y="151" fill="#b8c7c6" font-size="10">Esquema sin escala · ancho no acotado</text></svg>';
    sheet.querySelector("button").onclick = clearPin;
    sheet.querySelector("a")?.addEventListener("click", e => { e.preventDefault(); const node = document.getElementById(`spec-${item.replaceAll(" ", "-")}`); if (node) { node.open = true; node.scrollIntoView({block:"nearest"}); } });
    sheet.hidden = false;
    readout.classList.remove("is-visible");
    if(innerWidth<800)sheet.scrollIntoView({block:"nearest",behavior:"smooth"});
    if (pinned.material && !Array.isArray(pinned.material) && pinned.material.color) {
      const original = pinned.material, highlight = original.clone();
      highlight.color.offsetHSL(0,0.18,0.04); if (highlight.emissive) { highlight.emissive.copy(highlight.color); highlight.emissiveIntensity=0.12; }
      pinned.material = highlight; selectedMaterial = {object:pinned,original,highlight};
    }
  }
  const raycaster = new THREE.Raycaster(); raycaster.params.Line.threshold=0.7;
  function hitAt(event) {
    const r = viewer.canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2), viewer.activeCamera);
    return raycaster.intersectObjects(viewer.scene.children,true).find(hit => {
      if (!shown(hit.object) || !hit.object.userData.pickable) return false;
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex || 0] : hit.object.material;
      return ![...viewer.renderer.clippingPlanes,...(material?.clippingPlanes || [])].some(p=>p.distanceToPoint(hit.point)<0);
    });
  }
  let down = null, lastMove=0;
  viewer.canvas.addEventListener("pointerdown", e=>{down=[e.clientX,e.clientY];});
  viewer.canvas.addEventListener("pointerup", e=>{if(down && Math.hypot(e.clientX-down[0],e.clientY-down[1])<5) {const hit=hitAt(e);if(hit)pin(hit);else clearPin();}down=null;});
  viewer.canvas.addEventListener("dblclick", e=>{const hit=hitAt(e);if(hit){viewer.tween=null;viewer.controls.target.copy(hit.point);viewer.controls.update();}});
  const readout=document.querySelector("#readout");
  ctx.openElement = pin;
  viewer.canvas.addEventListener("pointermove",e=>{if(pinned || performance.now()-lastMove<90)return;lastMove=performance.now();const hit=hitAt(e);readout.classList.toggle("is-visible",!!hit);readout.textContent=hit ? hit.object.userData.pickable : "";});
  viewer.canvas.addEventListener("pointerleave",()=>readout.classList.remove("is-visible"));
  window.addEventListener("keydown",e=>{if(e.key==="Escape"){clearPin();if(tourIndex>=0)stopTour();}});

  function row(color,label,layer) {
    return `<button class="legend-entry" data-layer="${layer}" title="Apagar ${escape(label)}"><i style="background:${cssColor(color)}"></i><span>${escape(label)}</span></button>`;
  }
  function refresh() {
    const L=state.layers, rows=[];
    if(L.topografia)rows.push(row(P.contour,"Terreno natural · rampa de cotas","topografia"),row(P.interpolated,"Zona interpolada · sin curvas","topografia"));
    if(L.superficieLlenado)for(const mesh of groups.surfaces.userData.byKey.get("llenadoFinal").children){
      if(shown(mesh))rows.push(row(ctx.phaseStyle[mesh.userData.phase].color,`${ctx.phaseStyle[mesh.userData.phase].label} · rasante final`,"superficieLlenado"));
    }
    if (L.movimiento && !L.geosinteticos) {
      for (const [key,g] of groups.basins.userData.byPhase) if(state.view==="perfil" ? shown(g.userData.mesh || g) : shown(g.userData.rasante || g)) {
        const style=ctx.phaseStyle[key];
        rows.push(row(state.component==="excavacion"?P.excavation:earthColor(style.color,false), `${style.label} · corte`,"movimiento"));
        if(state.component!=="excavacion")rows.push(row(earthColor(style.color,true),`${style.label} · lleno`,"movimiento"));
      }
    }
    if([...groups.basins.userData.byPhase.values()].some(g=>g.userData.dike && shown(g.userData.dike)))rows.push(row(P.dike,"Dique · material de excavacion","dique"));
    if(state.component==="dique" && L.topografia)rows.push(row(P.excavation,"Rasante inicial · contexto","topografia"));
    if(L.geosinteticos)rows.push(row(state.sheet==="geomembrana"?P.membrane:state.sheet==="geotextilInferior"?P.textileLower:P.textileUpper,state.sheet==="geomembrana"?"Geomembrana PEAD":"Geotextil NT2000","geosinteticos"));
    if(L.filtros)rows.push(row(P.stone,"Filtro · bolo y malla · h 0,78 m","filtros"));
    if(L.filtros||L.tuberias)rows.push(row(P.concrete,"Pozos · fondo publicado / tapa MDT","tuberias"));
    if(L.tuberias || L.filtros) for(const k of ["tuberia6","tuberia10"])rows.push(row(networkColor(k),`${k==="tuberia6"?'PEAD 6"':'PEAD 10"'} · Ø ${(model.redes[k].radius*2).toFixed(3)} m real`,"tuberias"));
    if(L.tuberias)rows.push(row(P.pipe6,"Exterior: diametro visual minimo 0,50 m; alzado +0,35 m","tuberias"));
    for(const [key,color,label] of [["aguasLluvias",P.channel,"Canal · alzado visual +0,54 m"],["drenajes",P.water,"Cunetas · traza"],["vias",P.road,"Vias · trazas verificadas"],["alcantarillas",P.concrete,"Alcantarillas · simbolos CAD"],["chimeneas",P.cage,"Chimeneas · modulos de 2 m"],["estabilizacion",P.dike,"Estabilizacion"],["curvas",P.contourMajor,"Curvas · 1 m / directrices 5 m"]])if(L[key])rows.push(row(color,label,key));
    legend.innerHTML=rows.join(""); legend.hidden=!rows.length;
    document.querySelector("#channel-panel").hidden=!L.aguasLluvias;
    viewer.fillLight.intensity=state.component!=="conjunto" || state.view==="dique" ? 0.75 : 0.22;
    const terrain=viewer.groups.get("topografia").userData.mesh.material;
    const isolatedDike=state.view==="dique"||state.component==="dique";
    terrain.transparent=isolatedDike;terrain.opacity=isolatedDike?0.35:1;terrain.depthWrite=!isolatedDike;
    if(pinned&&!shown(pinned))clearPin();
    ctx.labelAnchors = new Map();
    for(const [key,basin] of groups.basins.userData.byVaso){
      let surface=null;
      basin.traverseVisible(n=>{if(n.isMesh&&n.userData.pickable?.includes("superficie de proyecto"))surface=n;});
      if(L.geosinteticos)surface=groups.linings.userData.byKey.get(key)?.userData.byKey.get(state.sheet);
      if(L.superficieLlenado)surface=groups.surfaces.userData.byKey.get("llenadoFinal").children.find(n=>n.userData.vaso===key&&shown(n));
      if(!surface)continue;
      const pos=surface.geometry.attributes.position;
      surface.geometry.computeBoundingBox();
      const center=surface.geometry.boundingBox.getCenter(new THREE.Vector3());let distance=Infinity,anchor=null;
      for(let i=0;i<pos.count;i+=3){const p=new THREE.Vector3().fromBufferAttribute(pos,i);const d=(p.x-center.x)**2+(p.z-center.z)**2;if(d<distance){distance=d;anchor=p;}}
      if(anchor){surface.updateWorldMatrix(true,false);ctx.labelAnchors.set(key,anchor.applyMatrix4(surface.matrixWorld));}
    }
    document.querySelectorAll("input[data-layer]").forEach(input=>input.checked=!!L[input.dataset.layer]);
    document.querySelectorAll("[data-phase]").forEach(b=>b.classList.toggle("is-active",!L.superficieLlenado&&Number(b.dataset.phase)===state.phase));
    if(tourIndex<0) saveUrl();
  }
  legend.addEventListener("click",e=>{const b=e.target.closest("[data-layer]");if(b){state.layers[b.dataset.layer]=!state.layers[b.dataset.layer];ctx.applyLayers();}});
  ctx.refreshPresentation=refresh;
  const oldScope=ctx.applyScope;ctx.applyScope=()=>{oldScope();refresh();};

  let restoring=false;
  function saveUrl() {
    if(restoring)return;
    const p=new URLSearchParams({vista:state.view,fase:state.phase,vaso:state.basin,elemento:state.component,lamina:state.sheet,plano:state.planKey,exageracion:state.exaggeration,capas:Object.keys(state.layers).filter(k=>state.layers[k]).join(",")});
    p.set("seccion",ctx.cut.station);
    p.set("vasoCorte",ctx.cut.vasoKey);
    if(!viewer.tween){p.set("camara",viewer.activeCamera.position.toArray().map(n=>n.toFixed(3)).join(","));p.set("objetivo",viewer.controls.target.toArray().map(n=>n.toFixed(3)).join(","));p.set("zoom",viewer.activeCamera.zoom);}
    history.replaceState(null,"",`#${p}`);
  }
  function restoreUrl() {
    if(!location.hash.includes("vista="))return;
    restoring=true;const p=new URLSearchParams(location.hash.slice(1));
    const mode=p.get("vista");if(document.querySelector(`[data-view="${CSS.escape(mode || "")}"]`))state.view=mode;
    const phase=Number(p.get("fase"));if(phase>=1&&phase<=4)state.phase=phase;
    if(["todos",...Object.keys(model.vasos)].includes(p.get("vaso")))state.basin=p.get("vaso");
    if([...document.querySelector("#component-filter").options].some(o=>o.value===p.get("elemento")))state.component=p.get("elemento");
    if(["geomembrana","geotextilInferior","geotextilSuperior"].includes(p.get("lamina")))state.sheet=p.get("lamina");
    if(p.has("capas")){const on=new Set(p.get("capas").split(","));for(const k of Object.keys(state.layers))state.layers[k]=on.has(k);}
    const ex=Number(p.get("exageracion"));if(ex>=1&&ex<=3)ctx.setExaggeration(ex);
    ctx.applyLayers();ctx.frame(state.view);ctx.syncComponents?.();
    if(model.vasos[p.get("vasoCorte")])ctx.setCutVaso(p.get("vasoCorte"));
    if(p.has("seccion")&&Number.isFinite(Number(p.get("seccion"))))ctx.setCutStation(Number(p.get("seccion")));
    if(state.basin!=="todos" && state.view!=="perfil")ctx.focusComponent();
    if(p.get("plano") && model.meta.planos[p.get("plano")])ctx.setPlan(p.get("plano"));
    const position=p.get("camara")?.split(",").map(Number),target=p.get("objetivo")?.split(",").map(Number);
    if(position?.length===3&&target?.length===3&&[...position,...target].every(n=>Number.isFinite(n)&&Math.abs(n)<1e7)){
      viewer.tween=null;viewer.activeCamera.position.fromArray(position);viewer.controls.target.fromArray(target);
      const zoom=Number(p.get("zoom"));if(zoom>0&&zoom<1000)viewer.activeCamera.zoom=zoom;
      viewer.activeCamera.updateProjectionMatrix();viewer.controls.update();
    }
    restoring=false;
  }
  window.addEventListener("hashchange",restoreUrl);
  viewer.controls.addEventListener("end",()=>{if(tourIndex<0)saveUrl();});
  const initialHash=location.hash;restoreUrl();if(!initialHash)saveUrl();

  const exportButton=document.createElement("button");exportButton.className="view-button";exportButton.id="export-png";exportButton.textContent="↓ PNG";exportButton.title="Exportar lamina PNG a doble resolucion";
  document.querySelector("#view-modes").append(exportButton);
  exportButton.onclick=async()=>{
    exportButton.disabled=true;
    const renderer=viewer.renderer,w=viewer.canvas.clientWidth,h=viewer.canvas.clientHeight,ratio=renderer.getPixelRatio();
    try {
      renderer.setPixelRatio(2);renderer.setSize(w,h,false);renderer.render(viewer.scene,viewer.activeCamera);
      const output=document.createElement("canvas");output.width=w*2;output.height=h*2+100;
      const g=output.getContext("2d");g.drawImage(viewer.canvas,0,0);g.fillStyle="#f1f3f1";g.fillRect(0,h*2,output.width,100);g.fillStyle="#233238";g.font="24px Segoe UI";
      g.fillText(`VERA II · ${state.view} · ${state.layers.superficieLlenado ? "llenado final de los vasos" : `fase ${state.phase}`} · ${new Date().toLocaleDateString("es-CO")}`,24,h*2+40);
      g.font="18px Segoe UI";g.fillText("Modelo de planos · escala vertical "+state.exaggeration+" · realces visuales declarados en el visor",24,h*2+75);
      if(state.view==="planta"){g.fillStyle="#eef3ed";g.strokeStyle="#eef3ed";g.font="28px Segoe UI";g.fillText("↑ N",24,48);g.fillText(north.querySelector(".scale-value").textContent,24,110);g.lineWidth=3;g.beginPath();g.moveTo(24,68);g.lineTo(24,78);g.lineTo(24+parseFloat(north.querySelector(".scale-bar").style.width)*2,78);g.lineTo(24+parseFloat(north.querySelector(".scale-bar").style.width)*2,68);g.stroke();}
      const blob=await new Promise(resolve=>output.toBlob(resolve,"image/png"));const url=URL.createObjectURL(blob);const a=document.createElement("a");a.download=`VERA-II-${state.view}.png`;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } finally {renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);exportButton.disabled=false;}
  };
  const screenSymbols=[];
  groups.networks.traverse(n=>{if(n.userData.screenHeight)screenSymbols.push(n);});
  groups.manholes.traverse(n=>{if(n.userData.screenHeight)screenSymbols.push(n);});
  groups.survey.children.forEach(n=>{n.userData.screenHeight=5/1.4;screenSymbols.push(n);});
  viewer.onAfterRender=()=>{
    const camera=viewer.activeCamera;
    for(const n of screenSymbols){const units=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom/viewer.canvas.clientHeight:2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*camera.position.distanceTo(n.position)/viewer.canvas.clientHeight;n.scale.setScalar(units*n.userData.screenHeight);}
    north.hidden=state.view!=="planta";
    if(!north.hidden){const camera=viewer.orthoCamera;const pxPerM=viewer.canvas.clientWidth*camera.zoom/(camera.right-camera.left);const desired=130/pxPerM;const power=10**Math.floor(Math.log10(desired));const length=[1,2,5,10].map(n=>n*power).reduce((a,b)=>Math.abs(b-desired)<Math.abs(a-desired)?b:a);north.querySelector(".scale-bar").style.width=`${length*pxPerM}px`;north.querySelector(".scale-value").textContent=`${length} m`;}
    updateScreenLabels(ctx);
  };
  refresh();
  if(!initialHash)ctx.frame(state.view);
}

function updateScreenLabels(ctx) {
  const {viewer,state,site}=ctx;
  if(!ctx.screenLabels){
    const host=document.createElement("div");host.className="screen-labels";viewer.canvas.parentElement.append(host);ctx.screenLabels={host,items:[]};
    for(const [key,vaso] of Object.entries(ctx.model.vasos)){
      const mid=vaso.eje.pts[Math.floor(vaso.eje.pts.length/2)];const y=site.elevationAt(...mid);
      const node=document.createElement("div");node.className="screen-label";node.textContent=`Vaso ${key.slice(-1)}`;host.append(node);ctx.screenLabels.items.push({node,key,point:new THREE.Vector3(site.x(mid[0]),site.y(y??site.minZ),site.z(mid[1]))});
    }
    for(const contour of ctx.terrain.contours.filter(c=>c.major)){
      for(let i=0;i<contour.pts.length;i+=Math.max(1,Math.floor(contour.pts.length/8))){const p=contour.pts[i];const node=document.createElement("span");node.className="contour-label";node.textContent=`${contour.z}`;host.append(node);ctx.screenLabels.items.push({node,contour:true,point:new THREE.Vector3(site.x(p[0]),site.y(contour.z),site.z(p[1]))});}
    }
    for(const source of ctx.groups.survey.children){
      const node=document.createElement("button");node.className="screen-label survey-label";node.textContent=source.userData.markerId||source.userData.pickable.split(" ")[0];host.append(node);
      node.onclick=()=>ctx.openElement({object:source,point:source.position.clone()});
      ctx.screenLabels.items.push({node,survey:true,point:source.position.clone()});
    }
  }
  viewer.groups.get("rotulos").visible=false;
  const w=viewer.canvas.clientWidth,h=viewer.canvas.clientHeight,occupied=[];
  const canvasRect=viewer.canvas.getBoundingClientRect();
  const exclusions=[document.querySelector("#legend"),document.querySelector(".map-reference")].filter(n=>n&&!n.hidden).map(n=>{const r=n.getBoundingClientRect();return{x:r.left-canvasRect.left,y:r.top-canvasRect.top,w:r.width,h:r.height};});
  for(const item of ctx.screenLabels.items){
    const active=item.survey ? state.layers.puntos : item.contour ? state.view==="planta"&&state.layers.curvas : state.layers.rotulos&&state.layers[item.key]&&(state.layers.movimiento||state.layers.geosinteticos||state.layers.dique||state.layers.superficieLlenado)&&(state.basin==="todos"||state.basin===item.key)&&state.view!=="perfil";
    const anchor=ctx.labelAnchors?.get(item.key)||item.point;
    const p=anchor.clone().project(viewer.activeCamera);let x=(p.x+1)*w/2,y=(1-p.y)*h/2;
    let valid=active&&p.z>=-1&&p.z<=1&&x>20&&x<w-110&&y>25&&y<h-80;
    if(item.contour){if(occupied.some(r=>Math.abs(r.x-x)<90&&Math.abs(r.y-y)<55))valid=false;}
    else {for(let i=0;i<8&&occupied.some(r=>Math.abs(r.x-x)<110&&Math.abs(r.y-y)<32);i++)y-=34;}
    if(exclusions.some(r=>x+100>r.x&&x<r.x+r.w&&y+25>r.y&&y<r.y+r.h))valid=false;
    item.node.hidden=!valid;if(!valid)continue;occupied.push({x,y});item.node.style.transform=`translate(${x}px,${y}px)`;
    item.node.style.opacity=item.contour?"0.85":String(THREE.MathUtils.clamp(900/viewer.activeCamera.position.distanceTo(item.point),0.55,1));
  }
}
