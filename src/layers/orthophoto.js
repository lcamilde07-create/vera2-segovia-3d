import * as THREE from "three";

/**
 * Ortofotos del dron (WebODM) drapeadas sobre el terreno.
 *
 * Cada vuelo trae una malla que sigue el MDT (generada por
 * tools/prepare_orthophoto.py, con las UV puestas por coordenada real) y su
 * imagen compuesta. Se muestra una a la vez; el selector la cambia. Sirve para
 * distinguir, con imagen real, que parte del relleno representa el modelo, y
 * para comparar el estado del sitio entre fechas.
 *
 * Va un poco por encima del terreno (LIFT) para que la foto no pelee con la
 * malla del MDT (z-fighting); las obras del modelo quedan por encima de la foto.
 */
const LIFT = 0.15;
const STEP = 0.25;   // separacion entre vuelos cuando se muestran juntos

export function buildOrthophoto(data, site) {
  const root = new THREE.Group();
  root.visible = false;
  if (!data || !data.flights || !data.flights.length) {
    return Object.assign(root, { userData: { flights: [], setFlight: () => {} } });
  }

  const loader = new THREE.TextureLoader();
  const meshes = new Map();
  const order = new Map();   // orden de cada vuelo, para apilarlos

  data.flights.forEach((f, i) => order.set(f.key, i));

  for (const flight of data.flights) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(flight.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(flight.uvs, 2));
    geometry.setIndex(flight.index);
    geometry.computeVertexNormals();

    const texture = loader.load(flight.image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,        // los bordes del vuelo son transparentes
      alphaTest: 0.5,           // recorta el fondo, no lo pinta negro
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // los vuelos mas recientes van un poco mas arriba: al mostrarlos juntos, el
    // nuevo queda encima donde se solapan y no pelean por el mismo plano
    mesh.userData.baseLift = LIFT + order.get(flight.key) * STEP;
    mesh.position.y = mesh.userData.baseLift * site.exaggeration;
    mesh.renderOrder = 2 + order.get(flight.key);
    mesh.visible = false;
    mesh.userData.pickable = `Ortofoto ${flight.name} · levantamiento con dron (WebODM)`;
    mesh.userData.flightKey = flight.key;
    root.add(mesh);
    meshes.set(flight.key, mesh);
  }

  let current = data.flights[data.flights.length - 1].key;   // el vuelo mas reciente

  // key = clave de un vuelo, o "ambas" para mostrar todos a la vez
  function setFlight(key) {
    current = key;
    for (const [k, mesh] of meshes) mesh.visible = key === "ambas" || k === key;
  }
  setFlight(current);

  root.userData = {
    flights: data.flights.map((f) => ({ key: f.key, name: f.name })),
    current: () => current,
    setFlight,
  };
  return root;
}
