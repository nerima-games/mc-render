import type { EntityModelDescriptor, EntityModelKind } from './entity-models/types.js'
import { Result, Schema } from 'effect'
import { ANIMAL_ENTITY_MODELS } from './entity-models/animals.js'
import { DISPLAY_MISC_ENTITY_MODELS } from './entity-models/special-entities/display-misc.js'
import { DRAGON_ENTITY_MODELS } from './entity-models/dragon.js'
import { HOSTILE_ENTITY_MODELS } from './entity-models/hostile-mobs.js'
import { NEUTRAL_MOB_ENTITY_MODELS } from './entity-models/special-entities/neutral-mobs.js'
import { PROJECTILE_ENTITY_MODELS } from './entity-models/special-entities/projectiles.js'
import { VEHICLES_TNT_ENTITY_MODELS } from './entity-models/vehicles-tnt.js'
import { VILLAGER_PLAYER_ENTITY_MODELS } from './entity-models/villagers-player.js'

const MINIMUM_ENTITY_MODEL_KIND_LENGTH = 1
const EMPTY_ENTITY_MODEL_KIND_LENGTH = 0
const MINIMUM_NON_BLANK_ENTITY_MODEL_KIND_LENGTH = 1

export const EntityModelKindSchema: Schema.Codec<EntityModelKind, string> = Schema.String
  .check(Schema.isMinLength(MINIMUM_ENTITY_MODEL_KIND_LENGTH))
  .check(Schema.makeFilter<string>((value) =>
    value.trim().length >= MINIMUM_NON_BLANK_ENTITY_MODEL_KIND_LENGTH || 'Entity model kind must be non-blank',
  ))
  .pipe(Schema.brand('EntityModelKind'))

export type UnsupportedEntityModel = Readonly<{
  readonly _tag: 'UnsupportedEntityModel'
  readonly kind: EntityModelKind
}>

export const UnsupportedEntityModelSchema: Schema.Codec<UnsupportedEntityModel, Readonly<{
  readonly _tag: 'UnsupportedEntityModel'
  readonly kind: string
}>> = Schema.Struct({
  _tag: Schema.Literal('UnsupportedEntityModel'),
  kind: EntityModelKindSchema,
})

export type InvalidEntityModelKind = Readonly<{
  readonly _tag: 'InvalidEntityModelKind'
  readonly reason: 'empty' | 'invalid-value'
}>

export const InvalidEntityModelKindSchema: Schema.Codec<InvalidEntityModelKind> = Schema.Struct({
  _tag: Schema.Literal('InvalidEntityModelKind'),
  reason: Schema.Literals(['empty', 'invalid-value']),
})

export type EntityModelResolutionIssue = UnsupportedEntityModel | InvalidEntityModelKind

export const EntityModelResolutionIssueSchema: Schema.Codec<
  EntityModelResolutionIssue,
  Schema.Codec.Encoded<typeof InvalidEntityModelKindSchema> |
    Schema.Codec.Encoded<typeof UnsupportedEntityModelSchema>
> = Schema.Union([
  InvalidEntityModelKindSchema,
  UnsupportedEntityModelSchema,
])

export const ENTITY_MODEL_CATALOG: ReadonlyArray<EntityModelDescriptor> = [
  ...ANIMAL_ENTITY_MODELS,
  ...DRAGON_ENTITY_MODELS,
  ...HOSTILE_ENTITY_MODELS,
  ...NEUTRAL_MOB_ENTITY_MODELS,
  ...PROJECTILE_ENTITY_MODELS,
  ...VEHICLES_TNT_ENTITY_MODELS,
  ...VILLAGER_PLAYER_ENTITY_MODELS,
  ...DISPLAY_MISC_ENTITY_MODELS,
]

export const ENTITY_MODEL_KINDS: ReadonlyArray<EntityModelKind> = ENTITY_MODEL_CATALOG.map(({ kind }) => kind)

/** Known kernel kinds without authored models. Every 0.17.0 entity kind is currently covered. */
export const UNSUPPORTED_ENTITY_MODEL_KINDS: ReadonlyArray<EntityModelKind> = []

const modelByKind = new Map(ENTITY_MODEL_CATALOG.map((model) => [model.kind, model]))

export const entityModelForKind = (
  kind: EntityModelKind,
): Result.Result<EntityModelDescriptor, UnsupportedEntityModel> => {
  const model = modelByKind.get(kind)
  if (model === undefined) {
    return Result.fail({ _tag: 'UnsupportedEntityModel', kind })
  }
  return Result.succeed(model)
}

export const decodeEntityModelKind = (input: unknown): Result.Result<EntityModelKind, InvalidEntityModelKind> => {
  const decoded = Schema.decodeUnknownResult(EntityModelKindSchema)(input)
  if (Result.isFailure(decoded)) {
    let reason: InvalidEntityModelKind['reason'] = 'invalid-value'
    if (typeof input === 'string' && input.length === EMPTY_ENTITY_MODEL_KIND_LENGTH) {
      reason = 'empty'
    }
    return Result.fail({
      _tag: 'InvalidEntityModelKind',
      reason,
    })
  }
  return Result.succeed(decoded.success)
}

/** Decode a host's raw kind before consulting the branded catalog. */
export const resolveEntityModel = (input: unknown): Result.Result<EntityModelDescriptor, EntityModelResolutionIssue> => {
  const decoded = decodeEntityModelKind(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure)
  }
  return entityModelForKind(decoded.success)
}
