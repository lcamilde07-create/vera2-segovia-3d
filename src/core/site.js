/**
 * Marco de referencia del sitio.
 *
 * Los datos vienen en MAGNA-SIRGAS (metros). La escena usa un origen local en
 * el centro del lote para que las coordenadas sean pequenas y la precision de
 * punto flotante no se degrade.
 *
 *   escena.x =  (este  - east0)
 *   escena.z = -(norte - north0)      // Z hacia el sur, para que Y sea arriba
 *   escena.y =  (cota  - base) * exageracion
 */
export class Site {
  constructor(terrain) {
    const g = terrain.grid;
    this.grid = g;
    this.east0 = g.east0 + ((g.nx - 1) * g.step) / 2;
    this.north0 = g.north0 + ((g.ny - 1) * g.step) / 2;

    const zs = g.z.filter((v) => v !== null);
    this.minZ = Math.min(...zs);
    this.maxZ = Math.max(...zs);
    this.base = this.minZ;
    this.exaggeration = 1;

    this.width = (g.nx - 1) * g.step;
    this.depth = (g.ny - 1) * g.step;
  }

  x(east) {
    return east - this.east0;
  }

  z(north) {
    return -(north - this.north0);
  }

  y(elevation) {
    return (elevation - this.base) * this.exaggeration;
  }

  /** Cota del terreno en un punto, interpolada bilinealmente en la malla. */
  elevationAt(east, north) {
    const g = this.grid;
    const fx = (east - g.east0) / g.step;
    const fy = (north - g.north0) / g.step;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= g.nx - 1 || iy >= g.ny - 1) return null;
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (x, y) => g.z[y * g.nx + x];
    const z00 = at(ix, iy);
    const z10 = at(ix + 1, iy);
    const z01 = at(ix, iy + 1);
    const z11 = at(ix + 1, iy + 1);
    const samples = [
      [z00, (1 - tx) * (1 - ty)],
      [z10, tx * (1 - ty)],
      [z01, (1 - tx) * ty],
      [z11, tx * ty],
    ].filter(([z]) => z !== null);
    if (!samples.length) return null;
    // En el borde de un hueco del MDT no se debe saltar al primer vertice
    // valido: eso mete escalones artificiales en vias y cunetas drapeadas.
    const weight = samples.reduce((sum, [, w]) => sum + w, 0);
    return samples.reduce((sum, [z, w]) => sum + z * w, 0) / Math.max(weight, 1e-9);
  }
}
