// Where the online features (card library, China specialization setup) live:
// the project's own server, PostgREST behind nginx (setup: server/README.md).
// Only logged-in requests get data (src/auth). VITE_CLOUD_URL overrides it at
// build time, e.g. to test another server.

const API_URL = 'https://110.42.238.185/ba-recard/api'

export const CLOUD_URL: string = (import.meta.env.VITE_CLOUD_URL || API_URL).trim().replace(/\/+$/, '')

export function cloudEnabled(): boolean {
  return CLOUD_URL !== ''
}
