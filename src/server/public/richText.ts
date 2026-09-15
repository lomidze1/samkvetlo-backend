import type { InlineNode, RichBlock } from '../../shared/contract/richText'

// ADR 0012 §3: Lexical's own node shapes aren't exported as a usable public
// type by @payloadcms/richtext-lexical, so this mapper works off the raw
// JSON structure directly (same shape its own lexicalToHtml converters read
// — see node_modules/@payloadcms/richtext-lexical/dist/features/converters).
interface LexicalNode {
  type?: string
  [key: string]: unknown
}
interface LexicalRootDoc {
  root?: { children?: unknown[] }
}

// Lexical's text-format bitmask (NodeFormat in
// @payloadcms/richtext-lexical/dist/lexical/utils/nodeFormat.js).
const IS_BOLD = 1
const IS_ITALIC = 1 << 1
const IS_UNDERLINE = 1 << 3

// Only these href schemes are allowed through (ADR 0012 §3: a link whose
// href starts with "javascript:" is dropped).
const SAFE_HREF = /^(https:|mailto:|tel:)/i

function childrenOf(node: LexicalNode): LexicalNode[] {
  return Array.isArray(node.children) ? (node.children as LexicalNode[]) : []
}

function mapInline(node: LexicalNode): InlineNode | null {
  switch (node.type) {
    case 'text': {
      const format = typeof node.format === 'number' ? node.format : 0
      const text = typeof node.text === 'string' ? node.text : ''
      const mark: InlineNode = { type: 'text', text }
      if (format & IS_BOLD) mark.bold = true
      if (format & IS_ITALIC) mark.italic = true
      if (format & IS_UNDERLINE) mark.underline = true
      return mark
    }
    case 'linebreak':
      return { type: 'linebreak' }
    case 'link':
    case 'autolink': {
      const fields = (node.fields as { linkType?: string; newTab?: boolean; url?: string } | undefined) ?? {}
      const href = typeof fields.url === 'string' ? fields.url : ''
      if (fields.linkType === 'internal' || !SAFE_HREF.test(href)) {
        console.warn(`richText: dropping link with unsafe/internal href: ${href || '(empty)'}`)
        return null
      }
      const children = mapInlineChildren(childrenOf(node)).filter(
        (child): child is Extract<InlineNode, { type: 'text' | 'linebreak' }> => child.type !== 'link',
      )
      return { type: 'link', href, newTab: Boolean(fields.newTab), children }
    }
    default:
      console.warn(`richText: dropping unknown inline node: ${node.type ?? '(untyped)'}`)
      return null
  }
}

function mapInlineChildren(nodes: LexicalNode[]): InlineNode[] {
  return nodes.map(mapInline).filter((node): node is InlineNode => node !== null)
}

const ALLOWED_HEADING_LEVEL: Record<string, 2 | 3 | 4> = {
  h1: 2,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 4,
  h6: 4,
}

function mapBlock(node: LexicalNode): RichBlock | null {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', children: mapInlineChildren(childrenOf(node)) }
    case 'heading': {
      const tag = typeof node.tag === 'string' ? node.tag : 'h2'
      return { type: 'heading', level: ALLOWED_HEADING_LEVEL[tag] ?? 2, children: mapInlineChildren(childrenOf(node)) }
    }
    case 'quote':
      return { type: 'quote', children: mapInlineChildren(childrenOf(node)) }
    case 'list': {
      const ordered = node.listType === 'number'
      const items = childrenOf(node)
        .filter((child) => child.type === 'listitem')
        .map((item) => ({
          // A nested sub-list inside a list item isn't representable in our
          // simplified schema — dropped (and logged) like any other unknown
          // node, its own items are not flattened into the parent.
          children: mapInlineChildren(childrenOf(item).filter((child) => child.type !== 'list')),
        }))
      return { type: 'list', ordered, items }
    }
    default:
      console.warn(`richText: dropping unknown block node: ${node.type ?? '(untyped)'}`)
      return null
  }
}

/** Converts a Lexical rich-text document into our closed RichBlock[] set. */
export function toRichBlocks(doc: LexicalRootDoc | null | undefined): RichBlock[] {
  const children = doc?.root?.children
  if (!Array.isArray(children)) return []
  return (children as LexicalNode[]).map(mapBlock).filter((block): block is RichBlock => block !== null)
}
