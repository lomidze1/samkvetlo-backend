// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { hasFailedNotification } from '@/components/admin/hasFailedNotification'

// T3.5, ADR 0007 §6: the ⚠ warning shown by FailedNotificationsWarning.tsx
// is driven entirely by this predicate — tested here directly rather than
// through the rendered component (no DB/UI needed for this pure function).
describe('hasFailedNotification (T3.5, ADR 0007 §6)', () => {
  it('is false when there are no notifications', () => {
    expect(hasFailedNotification(undefined)).toBe(false)
    expect(hasFailedNotification(null)).toBe(false)
    expect(hasFailedNotification([])).toBe(false)
  })

  it('is false when every notification succeeded', () => {
    expect(
      hasFailedNotification([
        { channel: 'email', status: 'sent', at: '2026-09-16T00:00:00.000Z' },
        { channel: 'sms', status: 'sent', at: '2026-09-16T00:00:01.000Z' },
      ]),
    ).toBe(false)
  })

  it('is true when at least one notification failed', () => {
    expect(
      hasFailedNotification([
        { channel: 'email', status: 'sent', at: '2026-09-16T00:00:00.000Z' },
        { channel: 'sms', status: 'failed', error: 'timeout', at: '2026-09-16T00:00:01.000Z' },
      ]),
    ).toBe(true)
  })
})
