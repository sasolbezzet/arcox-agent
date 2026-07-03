import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

test('Hermes config shape uses production provider and stdio MCP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcox-agent-'))
  process.env.ARCOX_HOME = join(root, '.arcox')
  process.env.ARCOX_AGENT_ENV = join(root, '.arcox', 'agent.env')
  process.env.HERMES_HOME = join(root, '.hermes')
  process.env.ARCOX_SKIP_HERMES_AUTH_CLEANUP = '1'
  const config = await import(`../lib/config.mjs?test=${Date.now()}`)
  writeFileSync(join(root, 'template'), 'EOA_PRIVATE_KEY=\nARCOX_AI_ROUTER_API_KEY=arx_sk_mcp\nARCOX_HERMES_API_KEY=arx_sk_model\n')
  config.ensureAgentEnv(join(root, 'template'))
  config.configureHermes()
  const yaml = parse(readFileSync(join(root, '.hermes', 'config.yaml'), 'utf8'))
  assert.equal(yaml.model.provider, 'custom')
  assert.equal(yaml.model.default, 'openai/gpt-oss-120b')
  assert.equal(yaml.model.base_url, 'https://arc-dex-bice.vercel.app/v1')
  assert.equal(yaml.model.api_key, 'arx_sk_model')
  assert.equal(yaml.providers.arcox, undefined)
  assert.equal(yaml.custom_providers.filter(item => item.name === 'ARCOX User').length, 1)
  assert.equal(yaml.custom_providers.find(item => item.name === 'ARCOX User').api_key, 'arx_sk_model')
  assert.deepEqual(yaml.mcp_servers.arcox.args, ['mcp'])
  assert.equal(yaml.mcp_servers.arcox.connect_timeout, 90)
  assert.equal(yaml.mcp_servers.arcox.timeout, 180)
  assert.deepEqual(yaml.toolsets, ['hermes-cli'])
  assert.equal(yaml.agent.reasoning_effort, 'low')
  assert.equal(yaml.agent.environment_probe, false)
  assert.equal(yaml.tools.tool_search.enabled, false)
  assert.equal(yaml.mcp_discovery_timeout, 10)
  assert.equal(yaml.platform_toolsets.cli.includes('terminal'), true)
  assert.equal(yaml.platform_toolsets.cli.includes('web'), true)
  assert.equal(yaml.platform_toolsets.cli.includes('context_engine'), true)
  assert.equal(yaml.platform_toolsets.cli.includes('messaging'), false)
  assert.equal(yaml.auxiliary.title_generation.provider, 'nvidia')
  assert.equal(statSync(config.AGENT_ENV).mode & 0o777, 0o600)
  assert.equal(config.hermesSummary().productionProvider, true)
  assert.equal(config.envSummary().apiKey, true)
  assert.equal(config.envSummary().hermesApiKey, true)
})
