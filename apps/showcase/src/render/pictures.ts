import type { MeshBuild, MeshGroup } from '../engine/mesh'

/** Answers the batches of one colour bucket, in chunk order. */
export function bucketBatches(mesh: MeshBuild, bucket: number): MeshGroup[] {
  return mesh.groups.filter((group) => group.bucket === bucket)
}
