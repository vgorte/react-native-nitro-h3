/** Names what the act draws: the raw cloud, the hexagons it aggregates into, or both at once. */
export type ViewMode = 'points' | 'heatmap' | 'both'

/** Names how the raw points reach the map: the scene image, or a circle layer of its own. */
export type PointsPath = 'image' | 'native'

/** Holds what one run is asked for and what of it is drawn. */
export interface Settings {
  seed: number
  points: number
  res: number
  /** What is drawn of the run; it costs no run of its own, so it never rebuilds one. */
  view: ViewMode
  /** How the raw points are drawn, which only stands where they are drawn at all. */
  path: PointsPath
}

/** Names what one control asks for; the act hands these to {@linkcode nextSettings}. */
export type Change =
  | { control: 'seed' }
  | { control: 'points'; value: number }
  | { control: 'res'; value: number }
  | { control: 'push' }
  | { control: 'view'; value: ViewMode }
  | { control: 'path'; value: PointsPath }

/**
 * The settings the act opens on: one unchunked block at a city block's resolution, points alone.
 *
 * The act opens on the cloud rather than on the hexagons, because the switch between them is what
 * it has to show: a scatter that reads as noise until the cells are counted.
 */
export const OPEN_SETTINGS: Settings = {
  seed: 1,
  points: 100_000,
  res: 9,
  view: 'points',
  path: 'image',
}

/** The point counts the control offers. */
export const POINT_CHOICES: readonly number[] = [100_000, 1_000_000]

/** The resolutions the control offers outside the push-it step. */
export const RES_CHOICES: readonly number[] = [7, 8, 9]

/** Points the push-it step drops. */
export const PUSH_POINTS = 1_000_000

/**
 * The resolution of the push-it step.
 *
 * It is the one whose distinct cells land between 100,000 and 160,000, the size the inset geometry
 * was measured holding 60 fps at: a million points of this mixture reach 3,454 cells at resolution
 * 8 and 515,147 at resolution 11, and 137,972 here.
 */
export const PUSH_RES = 10

/** Cells the push-it step reaches, measured over the seed the act opens on. */
export const PUSH_CELLS = 138_000

/** Answers whether the push-it step stands, which is both of its values at once. */
export function isPushed(settings: Settings): boolean {
  return settings.points === PUSH_POINTS && settings.res === PUSH_RES
}

/**
 * Answers the settings one control leaves behind.
 *
 * The push-it step is a preset of two values, so neither of them ever stands alone: leaving it by
 * the point count takes its resolution with it, and asking for its resolution sets its point count.
 * The resolution row therefore always lights one of the items it offers, and no run is ever asked
 * for a size the step alone describes; leaving it by one of the plain resolutions keeps the million
 * points, which is a state the row can light and the act can build.
 *
 * The two display choices leave the run alone, and the points path brings the points back with it:
 * a path picked while the hexagons stand on their own would otherwise change nothing on screen.
 */
export function nextSettings(current: Settings, change: Change): Settings {
  switch (change.control) {
    case 'seed':
      return { ...current, seed: current.seed + 1 }
    case 'push':
      return { ...current, points: PUSH_POINTS, res: PUSH_RES }
    case 'res':
      return change.value === PUSH_RES
        ? { ...current, points: PUSH_POINTS, res: PUSH_RES }
        : { ...current, res: change.value }
    case 'points':
      return isPushed(current) && change.value !== PUSH_POINTS
        ? { ...current, points: change.value, res: OPEN_SETTINGS.res }
        : { ...current, points: change.value }
    case 'view':
      return { ...current, view: change.value }
    case 'path':
      return {
        ...current,
        path: change.value,
        view: current.view === 'heatmap' ? 'both' : current.view,
      }
  }
}
