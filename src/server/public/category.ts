import type { Payload } from 'payload'

import type { Category } from '../../payload-types'
import type { PublicCategory, PublicCategoryRef } from '../../shared/contract/category'

interface CategoryNode {
  slug: string
  name: string
  parentId: number | null
  children: CategoryNode[]
}

function parentIdOf(parent: Category['parent']): number | null {
  if (typeof parent === 'number') return parent
  if (parent && typeof parent === 'object') return parent.id
  return null
}

function toPublicCategory(node: CategoryNode): PublicCategory {
  return { slug: node.slug, name: node.name, children: node.children.map(toPublicCategory) }
}

/** ADR 0012 §3: GET /api/public/categories — the full tree, anonymous read. */
export async function getPublicCategories(payload: Payload): Promise<PublicCategory[]> {
  const { docs } = await payload.find({
    collection: 'categories',
    overrideAccess: false,
    depth: 0,
    limit: 0,
    sort: 'name',
  })

  const byId = new Map<number, CategoryNode>()
  for (const doc of docs) {
    if (!doc.slug) continue
    byId.set(doc.id, { slug: doc.slug, name: doc.name, parentId: parentIdOf(doc.parent), children: [] })
  }

  const roots: CategoryNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  return roots.map(toPublicCategory)
}

/** The flat {slug, name} reference embedded in product DTOs. */
export function toPublicCategoryRef(category: Category | number | null | undefined): PublicCategoryRef | null {
  if (!category || typeof category === 'number' || !category.slug) return null
  return { slug: category.slug, name: category.name }
}
