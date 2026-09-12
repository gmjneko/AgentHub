import { VENDOR_CAPABILITIES } from '@agenthub/shared'
import type { AgentVendor } from './types.js'

export const CLAUDE_CAPABILITIES = VENDOR_CAPABILITIES.claude
export const CODEX_CAPABILITIES = VENDOR_CAPABILITIES.codex
export function getCapabilities(vendor: AgentVendor) {
  return VENDOR_CAPABILITIES[vendor]
}
