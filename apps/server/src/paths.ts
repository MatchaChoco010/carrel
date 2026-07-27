import { homedir } from 'node:os'
import { join } from 'node:path'

function xdg(envName: string, fallback: string): string {
  const value = process.env[envName]
  return value && value.length > 0 ? value : join(homedir(), fallback)
}

export function configDir(): string {
  return join(xdg('XDG_CONFIG_HOME', '.config'), 'pct')
}

export function stateDir(): string {
  return join(xdg('XDG_STATE_HOME', '.local/state'), 'pct')
}

export function configFile(): string {
  return join(configDir(), 'config.json')
}

export function indexDbFile(): string {
  return join(stateDir(), 'index.sqlite')
}

export function stateDbFile(): string {
  return join(stateDir(), 'state.sqlite')
}
