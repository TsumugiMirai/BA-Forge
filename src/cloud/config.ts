// Shared online card library (a Supabase project's REST API).
//
// Both values are PUBLIC client credentials: the project URL and its anon /
// publishable key, which Supabase designs to be shipped in web pages. Never
// put a service_role / secret key here. Setup: docs/cloud-setup.sql.
// Leave either value empty to hide the online library. VITE_CLOUD_URL and
// VITE_CLOUD_KEY override them at build time (e.g. to test another project).

const PROJECT_URL = 'https://qcfpkkwvzqzvmemzmhzs.supabase.co'
const PUBLIC_KEY = 'sb_publishable_YmUQxUTzOLUuPjfWHbyTHw_agcIlnmk'

export const CLOUD_URL: string = import.meta.env.VITE_CLOUD_URL || PROJECT_URL
export const CLOUD_KEY: string = import.meta.env.VITE_CLOUD_KEY || PUBLIC_KEY

export function cloudEnabled(): boolean {
  return CLOUD_URL.trim() !== '' && CLOUD_KEY.trim() !== ''
}
