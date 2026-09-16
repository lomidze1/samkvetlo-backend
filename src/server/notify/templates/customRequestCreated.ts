import type { CustomRequest } from '../../../payload-types'
import { ka } from '../../../i18n/ka'

export interface OwnerCustomRequestEmail {
  subject: string
  text: string
}

function surnameInitial(surname: string): string {
  return surname.trim().charAt(0)
}

/** "+995599123456" -> "599 123 456" (same shape as orderCreated.ts). */
function groupPhone(phone: string): string {
  const national = phone.replace(/\D/g, '').replace(/^995/, '')
  const match = national.match(/^(\d{3})(\d{3})(\d{3})$/)
  return match ? `${match[1]} ${match[2]} ${match[3]}` : phone
}

/** ADR 0011 §3 / ADR 0007 §4: owner email — category, description, contact, admin link. */
export function buildOwnerCustomRequestEmail(request: CustomRequest, adminUrl: string): OwnerCustomRequestEmail {
  const categoryLabel = ka.server.customRequestCategoryLabels[request.category]
  const lines = [
    ka.server.notify.customRequestCreated.ownerEmailCategoryLine(categoryLabel),
    ka.server.notify.customRequestCreated.ownerEmailContactLine(
      request.name,
      request.surname,
      groupPhone(request.phone),
    ),
    ka.server.notify.customRequestCreated.ownerEmailChurchLine(request.church),
    ka.server.notify.customRequestCreated.ownerEmailDescriptionLine(request.description),
    ka.server.notify.customRequestCreated.ownerEmailAdminLink(adminUrl),
  ]

  return {
    subject: ka.server.notify.customRequestCreated.ownerEmailSubject(request.number ?? ''),
    text: lines.join('\n'),
  }
}

/** ADR 0011 §3 / ADR 0007 §4: owner SMS, same shape as order's <= 140 chars. */
export function buildOwnerCustomRequestSms(request: CustomRequest): string {
  return ka.server.notify.customRequestCreated.ownerSms(
    request.number ?? '',
    request.name,
    surnameInitial(request.surname),
    groupPhone(request.phone),
  )
}
