/** Reine in Lofoten anchors the plane, so the readout names the coast the terrain plate shows. */
export const LAT0 = 67.93
export const LNG0 = 13.09

/** Degrees of latitude one plane unit of `pv` spans. */
export const LAT_PER_PV = 0.42

/**
 * Degrees of longitude one plane unit of `pu` spans. Dividing by the cosine of the anchor latitude
 * makes a plane unit cover the same ground distance east to west as north to south.
 */
export const LNG_PER_PU = LAT_PER_PV / Math.cos((LAT0 * Math.PI) / 180)
