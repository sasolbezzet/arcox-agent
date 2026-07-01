import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

test('Hermes config shape uses local provider and stdio MCP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcox-agent-'))
  process.env.ARCOX_HOME = join(root, '.arcox')
  process.env.ARCOX_AGENT_ENV = join(root, '.arcox', 'agent.env')
  process.env.HERMES_HOME = join(root, '.hermes')
  process.env.ARCOX_SKIP_HERMES_AUTH_CLEANUP = '1'
  const config = await import(`../lib/config.mjs?test=${Date.now()}`)
  writeFileSync(join(root, 'template'), 'EOA_PRIVATE_KEY=\n')
  config.ensureAgentEnv(join(root, 'template'))
  config.configureHermes()
  const yaml = parse(readFileSync(join(root, '.hermes', 'config.yaml'), 'utf8'))
  assert.equal(yaml.model.provider, 'custom:arcox-local')
  assert.equal(yaml.providers['arcox-local'].api_key, 'arcox-local')
  assert.deepEqual(yaml.mcp_servers.arcox.args, ['mcp'])
  assert.equal(statSync(config.AGENT_ENV).mode & 0o777, 0o600)
})
