// Account functions on the server (/rpc/…, see server/schema.sql): the
// logged-in account's own details, and the admin page (invite code, members).

import type { Account } from '../auth/auth'
import { parseAccount } from '../auth/auth'
import { CloudHttpError, rpc } from './rest'

/** who the login token belongs to */
export async function fetchMe(): Promise<Account | null> {
  return parseAccount(await rpc<unknown>('me'))
}

export async function saveDisplayName(displayName: string): Promise<Account | null> {
  return parseAccount(await rpc<unknown>('set_display_name', { display_name: displayName }))
}

export type PasswordChangeResult = 'ok' | 'wrong' | 'password' | 'error'

export async function changePassword(oldPassword: string, newPassword: string): Promise<PasswordChangeResult> {
  try {
    await rpc<boolean>('change_password', { old_password: oldPassword, new_password: newPassword })
    return 'ok'
  } catch (e) {
    if (e instanceof CloudHttpError) {
      if (e.status === 403) return 'wrong'
      if (e.reason === 'password') return 'password'
    }
    return 'error'
  }
}

export interface MemberRow {
  username: string
  display_name: string
  role: 'admin' | 'member'
  created_at: string
}

export interface InviteRow {
  code: string
  uses: number
  max_uses: number | null
  active: boolean
  created_at: string
}

export interface AdminOverview {
  accounts: MemberRow[]
  invites: InviteRow[]
}

export function adminOverview(): Promise<AdminOverview> {
  return rpc<AdminOverview>('admin_overview')
}

/** make `code` the one invite code that works */
export function adminSetInviteCode(code: string): Promise<AdminOverview> {
  return rpc<AdminOverview>('admin_set_invite_code', { code })
}

export function adminSetRole(username: string, role: 'admin' | 'member'): Promise<AdminOverview> {
  return rpc<AdminOverview>('admin_set_role', { username, role })
}

export function adminResetPassword(username: string, newPassword: string): Promise<boolean> {
  return rpc<boolean>('admin_reset_password', { username, new_password: newPassword })
}
