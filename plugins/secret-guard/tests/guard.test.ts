import { expect, test } from 'claude-code/testing'

// A JWT whose payload says role "service_role" (built here, not a real key)
const b64 = (s: string) => btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const jwt = (role: string) => `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(`{"iss":"supabase","role":"${role}","iat":1700000000}`)}.abcdefghijklmnopqrstuvwxyz012345`

test('blocks a secret written into code, lets public keys through', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const secret = await $.tool.call({ tool: 'Write', file_path: 'src/config.ts', content: `export const KEY = "sk-ant-${'a'.repeat(40)}"` })
  expect('deny' in secret && secret.deny).toContain('Anthropic API key')

  const service = await $.tool.call({ tool: 'Edit', file_path: 'src/db.ts', old_string: 'x', new_string: `const key = "${jwt('service_role')}"` })
  expect('deny' in service && service.deny).toContain('service_role')

  const anon = await $.tool.call({ tool: 'Write', file_path: 'src/db.ts', content: `const key = "${jwt('anon')}"` })
  expect('deny' in anon).toBe(false)

  const plain = await $.tool.call({ tool: 'Write', file_path: 'README.md', content: 'Hello' })
  expect('deny' in plain).toBe(false)
})
