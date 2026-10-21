import { type AppConfig, DEFAULT_APP_CONFIG } from "@app/shared/app-config"

declare global {
  interface Window {
    /** Rendered into index.html from admin settings over APP_NAME / APP_INFO (API in prod, Vite in dev). */
    __APP_CONFIG__?: AppConfig
  }
}

/** This instance's branding (single company per deployment). */
export const APP_CONFIG: AppConfig = window.__APP_CONFIG__ ?? DEFAULT_APP_CONFIG

/** Display name of this workplace instance. */
export const COMPANY_NAME = APP_CONFIG.name
