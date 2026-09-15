// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

// ADR 0012 §3: Lexical JSON is never sent to the frontend. The backend
// mapper (src/server/public/richText.ts) converts it into this small,
// closed set of blocks/inline nodes; an unknown Lexical node is dropped
// (and logged) rather than passed through.
const TextMarkSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
})

const LinebreakSchema = z.strictObject({
  type: z.literal('linebreak'),
})

// href is restricted to https:/mailto:/tel: by the mapper before this is
// ever constructed — see ADR 0012 §3 ("javascript: ბმული იშლება").
const LinkSchema = z.strictObject({
  type: z.literal('link'),
  href: z.string(),
  newTab: z.boolean(),
  children: z.array(z.union([TextMarkSchema, LinebreakSchema])),
})

const InlineNodeSchema = z.discriminatedUnion('type', [TextMarkSchema, LinkSchema, LinebreakSchema])
export type InlineNode = z.infer<typeof InlineNodeSchema>

const ParagraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  children: z.array(InlineNodeSchema),
})

const HeadingSchema = z.strictObject({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  children: z.array(InlineNodeSchema),
})

const QuoteSchema = z.strictObject({
  type: z.literal('quote'),
  children: z.array(InlineNodeSchema),
})

const ListItemSchema = z.strictObject({
  children: z.array(InlineNodeSchema),
})

const ListSchema = z.strictObject({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(ListItemSchema),
})

export const RichBlockSchema = z.discriminatedUnion('type', [
  ParagraphSchema,
  HeadingSchema,
  QuoteSchema,
  ListSchema,
])
export type RichBlock = z.infer<typeof RichBlockSchema>
