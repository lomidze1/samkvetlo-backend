import { describe, expect, it } from 'vitest'

import { toRichBlocks } from '@/server/public/richText'

function lexicalDoc(children: unknown[]) {
  return { root: { type: 'root', children } }
}

function textNode(text: string) {
  return { type: 'text', format: 0, text }
}

describe('toRichBlocks (T1.9, ADR 0012 §3)', () => {
  it('converts paragraph/heading/list/quote with bold/italic/underline text', () => {
    const blocks = toRichBlocks(
      lexicalDoc([
        { type: 'paragraph', children: [{ type: 'text', format: 1, text: 'bold' }] },
        { type: 'heading', tag: 'h3', children: [textNode('სათაური')] },
        {
          type: 'list',
          listType: 'number',
          children: [{ type: 'listitem', children: [textNode('ერთი')] }],
        },
        { type: 'quote', children: [textNode('ციტატა')] },
      ]),
    )

    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'bold', bold: true }] },
      { type: 'heading', level: 3, children: [{ type: 'text', text: 'სათაური' }] },
      { type: 'list', ordered: true, items: [{ children: [{ type: 'text', text: 'ერთი' }] }] },
      { type: 'quote', children: [{ type: 'text', text: 'ციტატა' }] },
    ])
  })

  it('drops a javascript: link entirely (ADR 0012 §3)', () => {
    const blocks = toRichBlocks(
      lexicalDoc([
        {
          type: 'paragraph',
          children: [
            textNode('preface '),
            {
              type: 'link',
              fields: { url: 'javascript:alert(1)', linkType: 'custom' },
              children: [textNode('click me')],
            },
            textNode(' suffix'),
          ],
        },
      ]),
    )

    const serialized = JSON.stringify(blocks)
    expect(serialized).not.toContain('javascript:')
    expect(serialized).not.toContain('click me')
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'preface ' }, { type: 'text', text: ' suffix' }] },
    ])
  })

  it('keeps a safe https:/mailto:/tel: link', () => {
    const blocks = toRichBlocks(
      lexicalDoc([
        {
          type: 'paragraph',
          children: [
            { type: 'link', fields: { url: 'https://samkvetlo.ge', newTab: true }, children: [textNode('საიტი')] },
          ],
        },
      ]),
    )
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'link', href: 'https://samkvetlo.ge', newTab: true, children: [{ type: 'text', text: 'საიტი' }] }],
      },
    ])
  })

  it('drops an unknown node type (e.g. relationship/upload) and returns [] for an empty doc', () => {
    const blocks = toRichBlocks(lexicalDoc([{ type: 'upload', value: { id: 1 } }]))
    expect(blocks).toEqual([])
    expect(toRichBlocks(undefined)).toEqual([])
    expect(toRichBlocks(null)).toEqual([])
  })
})
