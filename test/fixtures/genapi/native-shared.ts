import { t } from 'elysia'

export const querySchema = t.Object({ limit: t.Number(), enabled: t.Optional(t.Boolean()) })
