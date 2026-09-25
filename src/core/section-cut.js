import * as THREE from "three";
import { DIKE_COLOR, PHASE_STYLE, profileAt } from "../layers/basins.js";

/**
 * Corte del modelo por un plano perpendicular al eje de un vaso.
 *
 * El recorte de Three.js deja ver los cuerpos abiertos. Para leerlo como una
 * seccion de plano se superpone una tapa calculada desde las mismas secciones
 * transversales del expediente: terreno natural, rasantes de fase y escala de
 * cotas. Asi no se inventa geometria al cerrar la cara cortada.
 */
export class SectionCut {
  constructor(viewer, site, vasos, vasoKey = "vaso2") {
    this.viewer = viewer;
    this.site = site;
    this.vasos = vasos;
    this.vasoKey = vasoKey;
    this.vaso = vasos[vasoKey];
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.enabled = false;
    this.station = this.vaso.eje.longitud / 2;
    this.phaseLimit = Infinity;
    this.targets = [];

    viewer.renderer.localClippingEnabled = true;

    const width = 260;
    const height = 120;
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: 0x4fc3a1,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height)),
      new THREE.LineBasicMaterial({ color: 0x4fc3a1, transparent: true, opacity: 0.3 })
    );
    this.marker.add(border);
    this.marker.visible = false;
    viewer.scene.add(this.marker);

    this.cap = new THREE.Group();
    this.cap.visible = false;
    viewer.scene.add(this.cap);
  }

  /** Materiales a los que aplicar el corte. */
  collect(objects) {
    this.targets = [];
    for (const root of objects) {
      root.traverse((node) => {
        // tambien lineas y puntos: las redes y los geosinteticos se dibujan
        // con ellos, y si no se recortan siguen viendose por delante del corte
        const drawable = node.isMesh || node.isLine || node.isLineSegments || node.isPoints;
        if (!drawable || !node.material) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        this.targets.push(...materials);
      });
    }
  }

  setVaso(key) {
    if (!this.vasos[key]) return;
    this.vasoKey = key;
    this.vaso = this.vasos[key];
    this.station = Math.min(this.station, this.vaso.eje.longitud);
    this.setStation(this.station);
  }

  setPhaseLimit(phase) {
    this.phaseLimit = phase;
    this.#rebuildCap();
  }

  /** Posicion y direccion del eje en una abscisa. */
  #at(station) {
    const pts = this.vaso.eje.pts;
    const st = this.vaso.eje.station;
    let i = 0;
    while (i < st.length - 2 && st[i + 1] < station) i += 1;
    const f = (station - st[i]) / Math.max(st[i + 1] - st[i], 1e-6);
    const east = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
    const north = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    let dx = pts[i + 1][0] - pts[i][0];
    let dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    return { east, north, dx: dx / len, dy: dy / len, rightE: dy / len, rightN: -dx / len };
  }

  setStation(station) {
    this.station = Math.max(0, Math.min(station, this.vaso.eje.longitud));
    const a = this.#at(this.station);
    const normal = new THREE.Vector3(a.dx, 0, -a.dy).normalize();
    const point = new THREE.Vector3(this.site.x(a.east), 0, this.site.z(a.north));
    this.plane.setFromNormalAndCoplanarPoint(normal, point);

    this.marker.position.set(point.x, this.site.y(this.#elevationAt(this.station)) + 18, point.z);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.#rebuildCap();
    return a;
  }

  setEnabled(on) {
    this.enabled = on;
    this.marker.visible = on;
    this.cap.visible = on;
    for (const material of this.targets) {
      material.clippingPlanes = on ? [this.plane] : null;
      material.clipShadows = on;
      material.needsUpdate = true;
    }
  }

  sectionData() {
    return this.#sectionProfiles(this.station);
  }

  #sectionProfiles(station) {
    const sections = this.vaso.secciones;
    if (!sections.length) return null;
    let i = 0;
    while (i < sections.length - 2 && sections[i + 1].station < station) i += 1;
    const a = sections[i];
    const b = sections[Math.min(i + 1, sections.length - 1)];
    const f = Math.max(0, Math.min(1, (station - a.station) / Math.max(b.station - a.station, 1e-6)));
    const mix = (profileA, profileB) => {
      if (!profileA) return profileB || [];
      if (!profileB) return profileA || [];
      const offsets = new Set();
      for (const [o] of profileA) offsets.add(o);
      for (const [o] of profileB) offsets.add(o);
      return [...offsets].sort((x, y) => x - y).map((o) => [
        o,
        profileAt(profileA, o) + (profileAt(profileB, o) - profileAt(profileA, o)) * f,
      ]);
    };
    const surfaces = {};
    for (const phase of this.vaso.fases) {
      const p = mix(a.surfaces && a.surfaces[phase], b.surfaces && b.surfaces[phase]);
      if (p.length) surfaces[phase] = p;
    }
    return {
      vasoKey: this.vasoKey,
      station,
      terrain: mix(a.terrain, b.terrain),
      surfaces,
      phases: this.vaso.fases,
    };
  }

  #lowerProfile(data, phase) {
    const rank = data.phases.indexOf(phase);
    if (rank > 0 && data.surfaces[data.phases[rank - 1]]) return data.surfaces[data.phases[rank - 1]];
    return data.terrain;
  }

  #activeSpan(upper, lower) {
    const offsets = new Set();
    for (const [o] of upper) offsets.add(o);
    for (const [o] of lower) offsets.add(o);
    let lo = null;
    let hi = null;
    for (const o of [...offsets].sort((x, y) => x - y)) {
      if (Math.abs(profileAt(upper, o) - profileAt(lower, o)) > 0.03) {
        if (lo === null) lo = o;
        hi = o;
      }
    }
    return lo === null ? null : [lo, hi];
  }

  #place(sectionAt, offset, elevation, lift = 0.04) {
    return new THREE.Vector3(
      this.site.x(sectionAt.east + sectionAt.rightE * offset) - sectionAt.dx * lift,
      this.site.y(elevation),
      this.site.z(sectionAt.north + sectionAt.rightN * offset) + sectionAt.dy * lift
    );
  }

  /**
   * Masa de terreno de la seccion: de la linea de terreno natural hasta la
   * base del bloque.
   *
   * Sin ella el recorte dejaba un vacio bajo el terreno y se veian flotando
   * las chimeneas y las tuberias enterradas. Se teje por franjas y no en
   * abanico porque el perfil del terreno es concavo y un abanico solaparia
   * triangulos.
   */
  #groundMesh(sectionAt, terrain, baseElev, color) {
    const offsets = terrain.map(([o]) => o);
    const positions = [];
    const indices = [];
    for (let i = 0; i < offsets.length; i += 1) {
      const o = offsets[i];
      const top = this.#place(sectionAt, o, profileAt(terrain, o), 0);
      const bottom = this.#place(sectionAt, o, baseElev, 0);
      positions.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    );
    mesh.userData.pickable = "terreno natural en seccion";
    return mesh;
  }

  #profileMesh(sectionAt, upper, lower, span, color) {
    const [lo, hi] = span;
    const marks = new Set([lo, hi]);
    for (const [o] of upper) if (o > lo && o < hi) marks.add(o);
    for (const [o] of lower) if (o > lo && o < hi) marks.add(o);
    const offsets = [...marks].sort((a, b) => a - b);
    const shape = [];
    for (const o of offsets) shape.push(this.#place(sectionAt, o, profileAt(upper, o)));
    for (const o of offsets.slice().reverse()) shape.push(this.#place(sectionAt, o, profileAt(lower, o)));

    const positions = [];
    for (const p of shape) positions.push(p.x, p.y, p.z);
    const indices = [];
    for (let i = 1; i < shape.length - 1; i += 1) indices.push(0, i, i + 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 7;
    return mesh;
  }

  #polyline(sectionAt, profile, color, lift = 0.08, width = 1) {
    const positions = [];
    for (let i = 0; i < profile.length - 1; i += 1) {
      const a = this.#place(sectionAt, profile[i][0], profile[i][1], lift);
      const b = this.#place(sectionAt, profile[i + 1][0], profile[i + 1][1], lift);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92, linewidth: width })
    );
  }

  #label(text, position, color = "#e7eef1") {
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = 220 * scale;
    canvas.height = 64 * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.font = "600 22px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 110, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.position.copy(position);
    sprite.scale.set(22, 6, 1);
    sprite.renderOrder = 9;
    return sprite;
  }

  #rebuildCap() {
    this.cap.clear();
    const data = this.#sectionProfiles(this.station);
    if (!data) return;
    const sectionAt = this.#at(this.station);

    // primero la masa de terreno, que hace de fondo macizo de la seccion
    if (data.terrain.length) {
      this.cap.add(this.#groundMesh(sectionAt, data.terrain, this.site.minZ - 24, 0x6a5947));
    }

    const phases = data.phases.filter((phase) => Number(phase.split("/")[1]) <= this.phaseLimit);
    for (const phase of phases) {
      const upper = data.surfaces[phase];
      const lower = this.#lowerProfile(data, phase);
      if (!upper || !lower) continue;
      const span = this.#activeSpan(upper, lower);
      if (!span) continue;
      const style = PHASE_STYLE[phase] || { color: 0x8f9aa3 };
      const color = new THREE.Color(style.color);
      const mid = (span[0] + span[1]) / 2;
      if (profileAt(upper, mid) > profileAt(lower, mid)) color.lerp(new THREE.Color(DIKE_COLOR), 0.58);
      const mesh = this.#profileMesh(sectionAt, upper, lower, span, color);
      mesh.userData.pickable = `${style.label || phase} en sección`;
      this.cap.add(mesh);
    }

    this.cap.add(this.#polyline(sectionAt, data.terrain, 0xf2efe4, 0.12));
    if (phases.length && data.surfaces[phases[0]]) {
      this.cap.add(this.#polyline(sectionAt, data.surfaces[phases[0]], 0x9ee7d1, 0.14));
    }
    this.#addScale(sectionAt, data);
  }

  #addScale(sectionAt, data) {
    const allProfiles = [data.terrain, ...Object.values(data.surfaces)].filter(Boolean);
    const offsets = allProfiles.flatMap((p) => p.map(([o]) => o));
    const elevs = allProfiles.flatMap((p) => p.map(([, z]) => z));
    const minOffset = Math.min(...offsets) - 8;
    const minElev = Math.floor(Math.min(...elevs) / 5) * 5;
    const maxElev = Math.ceil(Math.max(...elevs) / 5) * 5;
    const positions = [];
    const add = (a, b) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let z = minElev; z <= maxElev; z += 5) {
      add(this.#place(sectionAt, minOffset, z, 0.18), this.#place(sectionAt, minOffset + 5, z, 0.18));
      this.cap.add(this.#label(`${z} m`, this.#place(sectionAt, minOffset - 6, z, 0.2), "#b7c7ce"));
    }
    add(this.#place(sectionAt, minOffset, minElev, 0.18), this.#place(sectionAt, minOffset, maxElev, 0.18));
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.cap.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0xb7c7ce, transparent: true, opacity: 0.8 })));
    this.cap.add(
      this.#label(
        `${this.vasoKey.replace("vaso", "Vaso ")} · abscisa ${formatStation(this.station)}`,
        this.#place(sectionAt, 0, maxElev + 4, 0.22),
        "#4fc3a1"
      )
    );
  }

  /** Cota del terreno en el eje, en la abscisa dada. */
  #elevationAt(station) {
    const data = this.#sectionProfiles(station);
    if (!data || !data.terrain.length) return this.site.minZ + 20;
    return profileAt(data.terrain, 0);
  }

  /** Camara mirando de frente a la cara cortada, a la altura de la obra. */
  /**
   * Encuadre de la vista de perfil.
   *
   * Se ajusta a la seccion que se esta cortando -terreno natural y rasantes-
   * en vez de usar una distancia fija: un vaso mide entre 170 y 290 m de eje y
   * con una distancia fija la seccion no cabia en pantalla.
   *
   * La camara va del lado que el plano de recorte descarta y mira a lo largo
   * del eje, que es la normal del plano: asi lo que queda delante de la cara
   * cortada esta recortado y se ve la seccion de frente.
   */
  cameraShot(station) {
    const a = this.#at(station);
    const data = this.#sectionProfiles(station);
    if (!data || !data.terrain.length) {
      const target = new THREE.Vector3(
        this.site.x(a.east),
        this.site.y(this.#elevationAt(station)) + 6,
        this.site.z(a.north)
      );
      const normal = new THREE.Vector3(a.dx, 0, -a.dy).normalize();
      return {
        position: target.clone().addScaledVector(normal, -135).setY(target.y + 40).toArray(),
        target: target.toArray(),
      };
    }

    const points = [];
    const offsets = [];
    const elevs = [];
    const take = (profile) => {
      for (const [offset, elevation] of profile) {
        points.push(this.#place(a, offset, elevation, 0));
        offsets.push(offset);
        elevs.push(elevation);
      }
    };
    take(data.terrain);
    for (const profile of Object.values(data.surfaces)) take(profile);

    // la escala de cotas va a la izquierda del perfil: entra en el encuadre,
    // porque si no queda cortada contra el borde del lienzo
    const scaleOffset = Math.min(...offsets) - 16;
    points.push(this.#place(a, scaleOffset, Math.min(...elevs), 0));
    points.push(this.#place(a, scaleOffset, Math.max(...elevs) + 6, 0));

    const normal = new THREE.Vector3(a.dx, 0, -a.dy).normalize();
    const direction = normal
      .clone()
      .multiplyScalar(-1)
      // casi de frente: en picado se veria el hueco que deja el recorte por
      // debajo del terreno, y una seccion se lee de frente, como en el plano
      .add(new THREE.Vector3(0, 0.11, 0))
      .normalize();

    return this.viewer.framePoints(points, direction, 1.16, 0.06);
  }
}

export function formatStation(value) {
  return `${Math.floor(value / 1000)}+${String(Math.round(value % 1000)).padStart(3, "0")}`;
}
