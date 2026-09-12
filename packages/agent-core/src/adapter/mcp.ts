import type { CodexOptions } from '@openai/codex-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { AgentVendor } from './types.js'

export class AgentConfigurationError extends Error {
  readonly code = 'UNSUPPORTED_CONFIGURATION'
}

/** Validate the JSON boundary before passing configuration to either SDK. */
export function validateMcp(servers: Record<string, unknown>, vendor: AgentVendor): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(servers)) {
    const fail = (message: string): never => { throw new AgentConfigurationError(`MCP ${name}: ${message}`) }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) fail('server name must contain letters, digits, underscore or dash')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('expected a server object')
    const value = raw as Record<string, unknown>
    const type = value.type ?? (value.command ? 'stdio' : undefined)
    if (type !== 'stdio' && type !== 'http' && type !== 'sse') fail('expected stdio, http or sse transport')
    if (vendor === 'codex' && type === 'sse') fail('Codex does not support SSE transport; use HTTP')
    const keys = type === 'stdio' ? ['type', 'command', 'args', 'env'] : ['type', 'url', 'headers']
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`unsupported field ${key}`)
    if (type === 'stdio') {
      if (typeof value.command !== 'string' || !value.command.trim()) fail('command must be nonempty')
      if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every(x => typeof x === 'string'))) fail('args must be strings')
    } else {
      if (typeof value.url !== 'string') fail('url is required')
      try { if (!['https:', 'http:'].includes(new URL(value.url as string).protocol)) fail('expected HTTP URL') }
      catch { fail('expected HTTP URL') }
    }
    const dict = type === 'stdio' ? value.env : value.headers
    if (dict !== undefined && (!dict || typeof dict !== 'object' || Array.isArray(dict) || !Object.values(dict).every(x => typeof x === 'string'))) fail('env/headers must contain string values')
    result[name] = { ...value, type } as McpServerConfig
  }
  return result
}

export function codexMcp(servers: Record<string, unknown>): NonNullable<CodexOptions['config']> {
  const result: NonNullable<CodexOptions['config']> = {}
  for (const [name, server] of Object.entries(validateMcp(servers, 'codex'))) {
    if ('command' in server) {
      result[name] = { command: server.command, ...(server.args ? { args: server.args } : {}), ...(server.env ? { env: server.env } : {}) }
    } else if ('url' in server) {
      result[name] = { url: server.url, ...(server.headers ? { http_headers: server.headers } : {}) }
    }
  }
  return result
}
