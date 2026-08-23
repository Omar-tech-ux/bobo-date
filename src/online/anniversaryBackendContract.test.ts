import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const functionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/notify-anniversary/index.ts'),
  'utf8',
)
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260824010000_anniversary_reminders.sql'),
  'utf8',
)
const config = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8')

describe('anniversary backend contract', () => {
  it('authenticates the internal request before loading private reminder data', () => {
    expect(config).toContain('[functions.notify-anniversary]\nverify_jwt = false')
    expect(functionSource).toContain("request.headers.get('x-anniversary-secret')")
    expect(functionSource.indexOf("request.headers.get('x-anniversary-secret')"))
      .toBeLessThan(functionSource.indexOf(".from('anniversary_reminder_settings')"))
  })

  it('keeps the schedule, couple guard, RLS, and atomic delivery claim in versioned SQL', () => {
    expect(migration).toContain("timezone('Asia/Amman', now())")
    expect(migration).toContain("'* * 13-15 * *'")
    expect(migration).toContain("local_time < time '00:15'")
    expect(migration).toContain("local_time < time '10:15'")
    expect(migration).toContain('(select count(*) from public.couples where sealed = true) = 1')
    expect(migration).toContain('enable row level security')
    expect(migration).toContain('claim_anniversary_delivery')
    expect(migration).toContain('on conflict (subscription_id, reminder_date, slot) do update')
    expect(migration).toContain("status = 'failed'")
    expect(migration).toContain('lease_expires_at < now()')
    expect(functionSource).toContain(".eq('couples.sealed', true)")
  })
})
