// Simple page login with one shared account, in front of the online features
// (card library, China specialization setup).
//
// This is a courtesy gate, not security: the check runs in the browser and the
// database key ships with the page, so anyone who reads the page source can
// get past it. It keeps casual visitors from changing shared data.

/** sha256 of "<account>:<password>" for the single account */
const ACCOUNT_HASH = 'f6bd2d1a9a2798aa5b2a000d477587b65aaac9a417064d91ed2bcd8714bbba89'
const STORAGE_KEY = 'ba-recard.auth'

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checkLogin(account: string, password: string): Promise<boolean> {
  return (await sha256Hex(`${account.trim()}:${password}`)) === ACCOUNT_HASH
}

/** logged in earlier in this browser (and the account has not changed since) */
export function isRemembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === ACCOUNT_HASH
  } catch {
    return false
  }
}

export function rememberLogin(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, ACCOUNT_HASH)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // not fatal: the login just isn't remembered
  }
}
