import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  auth: true,
  fields: [
    // Email added by default
    // Add more fields as needed
  ],
}
