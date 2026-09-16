import { APIError, type CollectionBeforeValidateHook } from 'payload'

// ADR 0014 §4: partner accounts use a password-manager-generated password
// of >= 16 characters. This is only enforceable in code if a collection
// hook actually sees the plaintext password before Payload hashes it.
//
// Verified against Payload 3.89.0 source
// (node_modules/payload/dist/collections/operations/create.js and
// .../operations/utilities/update.js): on both `create` and `update`, the
// collection-level `hooks.beforeValidate` array runs with `data.password`
// still present in plaintext — the password field is handled specially
// (outside the normal field beforeValidate/beforeChange traversal) and is
// only hashed afterwards, right before the DB write. So this hook can see
// and reject a too-short password before it is ever hashed or stored.
export const PASSWORD_MIN_LENGTH = 16

export const enforcePasswordMinLength: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (
    (operation === 'create' || operation === 'update') &&
    typeof data?.password === 'string' &&
    data.password.length > 0 &&
    data.password.length < PASSWORD_MIN_LENGTH
  ) {
    throw new APIError('err.passwordTooShort', 400, { minLength: PASSWORD_MIN_LENGTH }, true)
  }
  return data
}
