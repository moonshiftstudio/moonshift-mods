import { expect, test } from 'claude-code/testing'

const SPAWN = {
  prompt: 'Find the scanner code',
  description: 'Find scanner code',
  tool_use_id: 'tu1',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-fable-5-2',
  background: false,
  fork: false,
} as const

test('search helpers go to Haiku and general helpers to Sonnet, never as an upgrade', async ($, on) => {
  const seen: (string | undefined)[] = []
  on('store.set', () => ({ value: undefined }))
  on('agent.spawn', (_, e) => {
    seen.push(e.model)

    return { model: e.model ?? e.parentModel, agentId: 'a1' }
  })

  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose' })
  // The call picked a model itself: left alone.
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', model: 'opus' })
  // Planning keeps the main model.
  await $.agent.spawn({ ...SPAWN, subagentType: 'Plan' })
  // A fork always runs on its parent's model.
  await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose', fork: true })
  // Someone else's agent keeps its own model.
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', provider: { plugin: 'other', tier: 'user' } })
  // A Sonnet session: general helpers are not moved "down" to Sonnet, search still goes to Haiku.
  await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose', parentModel: 'claude-sonnet-5-5' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', parentModel: 'claude-sonnet-5-5' })
  // A Haiku session: nothing to save.
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', parentModel: 'claude-haiku-5-5' })

  expect(seen).toEqual(['haiku', 'sonnet', 'opus', undefined, undefined, undefined, undefined, 'haiku', undefined])
})

test('browser screenshots are shrunk, on their own and inside a batch; nothing else is touched', async ($, on) => {
  const seen: Record<string, unknown>[] = []
  on('store.set', () => ({ value: undefined }))
  on('tool.call', (_, e) => {
    seen.push(e as unknown as Record<string, unknown>)

    return { result: {} }
  })

  await $.tool.call({ tool: 'mcp__Claude_Browser__computer', action: 'screenshot' })
  await $.tool.call({ tool: 'mcp__claude-in-chrome__computer', action: 'screenshot', tabId: 1 })
  await $.tool.call({ tool: 'mcp__Claude_Browser__computer', action: 'screenshot', scale: 1 })
  await $.tool.call({ tool: 'mcp__Claude_Browser__computer', action: 'zoom', region: [0, 0, 10, 10] })
  await $.tool.call({ tool: 'mcp__Claude_Browser__computer', action: 'left_click', coordinate: [5, 5] })
  await $.tool.call({
    tool: 'mcp__Claude_Browser__browser_batch',
    actions: [
      { name: 'navigate', input: { url: 'https://example.com' } },
      { name: 'computer', input: { action: 'screenshot' } },
      { name: 'computer', input: { action: 'left_click', coordinate: [1, 2] } },
    ],
  })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(seen[0]?.scale).toBe(0.6)
  expect(seen[1]?.scale).toBe(0.6)
  expect(seen[2]?.scale).toBe(1)
  expect(seen[3]?.scale).toBeUndefined()
  expect(seen[4]?.scale).toBeUndefined()
  const steps = seen[5]?.actions as { input: Record<string, unknown> }[]
  expect(steps[0]?.input.scale).toBeUndefined()
  expect(steps[1]?.input.scale).toBe(0.6)
  expect(steps[2]?.input.scale).toBeUndefined()
  expect(seen[6]?.command).toBe('ls')
})

test('/saver switches a part off, remembers it, and reports it', async ($, on) => {
  const stored: Record<string, unknown> = {}
  const seen: (string | undefined)[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', (_, e) => {
    seen.push(e.model)

    return { model: e.model ?? e.parentModel, agentId: 'a1' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const off = await $.command.run({ command: 'saver', args: 'agents off' })
  expect(off.text).toContain('**Helper agents on a cheaper model:** off')
  expect((stored.settings as { agents: boolean }).agents).toBe(false)

  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
  expect(seen).toEqual([undefined])

  const size = await $.command.run({ command: 'saver', args: 'screenshots 50' })
  expect(size.text).toContain('kept at 50% size (about 25% of the tokens)')
  expect((await $.command.run({ command: 'saver', args: 'banana' })).text).toContain('Type `/saver`')
})

test('/handoff shows the note, saves a copy, and says so when there is nothing to hand off', async ($, on) => {
  const files: Record<string, string> = {}
  let answer: unknown = { isAnswered: true, text: 'Handoff from an earlier chat.\n## Goal\n- Ship it', usage: {} }
  on('store.set', () => ({ value: undefined }))
  on('model.fork', () => ({ value: answer as never }))
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\tester' : undefined }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 14, 9, 30) }))
  on('fs.write', (_, e) => {
    files[e.path.split(String.fromCharCode(92)).join("/")] = e.text

    return { value: undefined }
  })
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-surface' } }))

  const done = await $.command.run({ command: 'handoff', args: '' })
  expect(done.text).toContain('paste the note below')
  expect(done.text).toContain('## Goal')
  expect(files['C:/Users/tester/.claude/handoffs/handoff-2026-11-14-09-30.md']).toContain('Ship it')

  answer = { isAnswered: false, reason: 'nothing-to-fork' }
  expect((await $.command.run({ command: 'handoff', args: '' })).text).toContain('Nothing to hand off yet')
})

test('a long chat gets one nudge, then another only after it grows a lot more', async ($, on) => {
  const toasts: string[] = []
  let tokens = 40_000
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  const end = () =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  await end()
  expect(toasts).toHaveLength(0)
  tokens = 160_000
  await end()
  await end()
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('/handoff')
  tokens = 240_000
  await end()
  expect(toasts).toHaveLength(2)
})
