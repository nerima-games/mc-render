import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
  EntityModelVector,
} from '../types.js'
import { Brand } from 'effect'
import models from '../generated/display-misc.json' with { type: 'json' }

const modelKind = Brand.nominal<EntityModelKind>()
const partIdentifier = Brand.nominal<EntityModelPartIdentifier>()
const partRole = Brand.nominal<EntityModelPartRole>()

type SourceModel = (typeof models)[number]
type SourcePart = SourceModel['parts'][number]

const vector = (source: SourcePart['size']): EntityModelVector => [source.x, source.y, source.z]
const color = (source: SourcePart['color']): EntityModelColor => [source.red, source.green, source.blue]

const part = (source: SourcePart): EntityModelPartDescriptor => {
  const descriptor = {
    center: vector(source.center),
    color: color(source.color),
    id: partIdentifier(source.id),
    role: partRole(source.role),
    size: vector(source.size),
  }
  if (source.rotation === null) {
    return descriptor
  }
  return { ...descriptor, rotation: vector(source.rotation) }
}

const model = (source: SourceModel): EntityModelDescriptor => ({
  kind: modelKind(source.kind),
  parts: source.parts.map(part),
})

export const DISPLAY_MISC_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = models.map(model)
