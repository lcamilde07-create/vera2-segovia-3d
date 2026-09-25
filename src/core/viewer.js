import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Balance de luz. La suma de sol, cielo y entorno estaba muy por encima de 1 y
// las caras encaradas al sol se iban a blanco: un ocre de ladera (143,124,102)
// acababa saliendo a (226,213,196). Con estos valores sale a (183,161,133).
const ENV_INTENSITY = 0.38;
const SUN_INTENSITY = 1.75;
const SKY_INTENSITY = 0.62;
const FILL_INTENSITY = 0.26;

/** Renderizador, camara, controles y modos de vista. */
export class Viewer {
  constructor(canvas, site) {
    this.canvas = canvas;
    this.site = site;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = this.#horizonTexture();

    const span = Math.max(site.width, site.depth);
    // niebla muy lejana: solo suaviza el horizonte, no apaga el terreno
    this.scene.fog = new THREE.Fog(0x4d4038, span * 3.2, span * 7.5);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, span * 8);
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -span * 4, span * 8);
    this.activeCamera = this.camera;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = span * 3;
    this.controls.screenSpacePanning = false;

    this.#addEnvironment();
    this.#addLights(span);
    this.#addGround(span);

    this.groups = new Map();
    this.tween = null;

    window.addEventListener("resize", () => this.resize());
  }

  #horizonTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    // fondo de estudio: azul frio arriba que baja a una bruma calida en el
    // horizonte y a un piso oscuro; da profundidad y hace resaltar el modelo
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0.0, "#3a4356");
    gradient.addColorStop(0.4, "#4a4a52");
    gradient.addColorStop(0.52, "#7a6a56");   // bruma calida (hora dorada) en el horizonte
    gradient.addColorStop(0.6, "#4d4038");
    gradient.addColorStop(0.78, "#241d1a");
    gradient.addColorStop(1.0, "#100b09");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  #addEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  #addLights(span) {
    // cielo con tono mas calido (marfil) y suelo en ocre tibio: ambiente de tarde
    this.scene.add(new THREE.HemisphereLight(0xfaeede, 0x4a4038, SKY_INTENSITY));

    const sun = new THREE.DirectionalLight(0xffe6bf, SUN_INTENSITY);
    sun.position.set(-span * 0.5, span * 0.9, span * 0.5);
    sun.castShadow = true;
    // sombra mas nitida y suave a la vez: mapa mas grande + penumbra
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.radius = 3;
    const c = sun.shadow.camera;
    c.left = -span * 0.7;
    c.right = span * 0.7;
    c.top = span * 0.7;
    c.bottom = -span * 0.7;
    c.near = 1;
    c.far = span * 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(0xb8c4cf, FILL_INTENSITY);
    fill.position.set(span * 0.6, span * 0.35, -span * 0.5);
    this.scene.add(fill);
    this.fillLight = fill;
  }

  #addGround(span) {
    const grid = new THREE.GridHelper(span * 2.2, 44, 0x2b3a42, 0x1d272c);
    // por debajo de la base del bloque de terreno, o la atraviesa
    grid.position.y = -34;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.scene.add(grid);
    this.gridHelper = grid;
  }

  /** Registra un grupo de escena bajo una clave de capa. */
  register(key, object3d) {
    object3d.name = key;
    this.groups.set(key, object3d);
    this.applyEnvironment(object3d);
    this.scene.add(object3d);
    return object3d;
  }

  /**
   * Baja el peso del entorno en los materiales de un objeto.
   *
   * En esta version de three el entorno no tiene intensidad propia, asi que se
   * ajusta material a material. Sin esto el entorno se suma entero a la luz
   * del sol y las laderas encaradas al sol salian lavadas.
   */
  applyEnvironment(object3d) {
    object3d.traverse((node) => {
      if (!node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material && material.isMeshStandardMaterial) {
          material.envMapIntensity = ENV_INTENSITY;
        }
      }
    });
  }

  setLayerVisible(key, visible) {
    const g = this.groups.get(key);
    if (g) g.visible = visible;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = Math.max(this.canvas.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const half = this.orthoHalf || Math.max(this.site.width, this.site.depth) * 0.58;
    const aspect = w / h;
    this.orthoCamera.left = -half * aspect;
    this.orthoCamera.right = half * aspect;
    this.orthoCamera.top = half;
    this.orthoCamera.bottom = -half;
    this.orthoCamera.updateProjectionMatrix();
  }

  /** Mueve la camara suavemente a una posicion y objetivo dados. */
  flyTo(position, target, ms = 900) {
    const camera = this.activeCamera;
    const from = camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const to = new THREE.Vector3(...position);
    const toTarget = new THREE.Vector3(...target);
    const t0 = performance.now();
    this.tween = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      camera.position.lerpVectors(from, to, e);
      this.controls.target.lerpVectors(fromTarget, toTarget, e);
      if (t >= 1) this.tween = null;
    };
  }

  /**
   * Encaja la camara sobre unos vertices, mirando desde `direction`.
   *
   * Se ajusta a la **caja de la silueta proyectada**, no al centroide de la
   * nube: el centroide de un terreno asimetrico no cae en el centro de lo que
   * se ve, y la vista salia descentrada y con aire muerto a un lado. Aqui se
   * proyectan los puntos sobre los ejes de pantalla, se toma el centro de esa
   * caja como punto de mira y la distancia sale de sus semiejes.
   *
   * `bias` sube el encuadre en fraccion de la altura visible, para dejar sitio
   * a la leyenda que se superpone al pie del lienzo.
   */
  framePoints(points, direction, padding = 1.06, bias = 0) {
    if (!points.length) return { position: [0, 0, 0], target: [0, 0, 0] };

    const origin = new THREE.Vector3();
    for (const p of points) origin.add(p);
    origin.multiplyScalar(1 / points.length);

    const forward = direction.clone().normalize();   // del centro hacia la camara
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();

    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;

    const rel = new THREE.Vector3();
    let uMin = Infinity, uMax = -Infinity;
    let vMin = Infinity, vMax = -Infinity;
    let dMin = Infinity, dMax = -Infinity;
    for (const p of points) {
      rel.copy(p).sub(origin);
      const u = rel.dot(right);
      const v = rel.dot(up);
      const d = rel.dot(forward);
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }

    const legend = document.querySelector("#legend");
    const occupied = legend && getComputedStyle(legend).position === "absolute"
      ? Math.min(legend.getBoundingClientRect().height + 24, this.canvas.clientHeight * 0.35) : 0;
    const free = Math.max(0.6, 1 - occupied / this.canvas.clientHeight);
    bias = (1 - free) / (2 * free);
    const halfV = Math.max((vMax - vMin) / 2, 1e-3);
    const dMid = (dMin + dMax) / 2;
    const uc = (uMin + uMax) / 2;
    const vc = (vMin + vMax) / 2 - bias * halfV * 2;

    const target = origin
      .clone()
      .addScaledVector(right, uc)
      .addScaledVector(up, vc)
      .addScaledVector(forward, dMid);

    if (this.activeCamera.isOrthographicCamera) {
      this.orthoHalf = Math.max(halfV / free, (uMax - uMin) / (2 * this.camera.aspect)) * padding;
      this.orthoCamera.zoom = 1;
      this.resize();
      return { position: target.clone().addScaledVector(forward, 800).toArray(), target: target.toArray() };
    }

    // distancia justa: la minima a la que todo punto sigue dentro del cono de
    // vision. Se mide punto a punto y no por la caja, porque lo que sobresale
    // en anchura no suele ser lo que sobresale en profundidad, y acotar por la
    // caja entera aleja la camara mucho mas de lo necesario.
    let distance = 0;
    for (const p of points) {
      rel.copy(p).sub(target);
      const d = rel.dot(forward);
      distance = Math.max(
        distance,
        Math.abs(rel.dot(right)) / tanH + d,
        Math.abs(rel.dot(up)) / (tanV * free) + d
      );
    }

    return {
      position: target.clone().addScaledVector(forward, distance * padding).toArray(),
      target: target.toArray(),
    };
  }

  render() {
    if (this.tween) this.tween();
    this.controls.update();
    this.renderer.render(this.scene, this.activeCamera);
    this.onAfterRender?.();
  }

  setPlanMode(enabled) {
    this.tween = null;
    this.activeCamera = enabled ? this.orthoCamera : this.camera;
    this.controls.object = this.activeCamera;
    this.controls.enableRotate = !enabled;
    this.controls.screenSpacePanning = enabled;
    this.controls.update();
  }
}
