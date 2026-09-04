/** Configures every act; an inactive act draws nothing and runs no loop. */
export interface ActProps {
  active: boolean
  /** The cell the Inspector stands open on, which the act draws its highlight around. */
  inspected?: bigint | null
  /** Opens the Inspector on a cell, from whatever gesture or control the act gives it. */
  onInspect?: (cell: bigint) => void
}
