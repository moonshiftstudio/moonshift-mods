import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-watch',
  component: 'Pane',
  requestId: 'agent-watch',
  props: {
    title: 'Agent Watch',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a helper agent shows its task, what it is doing, and then that it finished', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-watch' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    prompt: 'Find the scanner code',
    description: 'Find scanner code',
    subagentType: 'Explore',
    tool_use_id: 'tu1',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-fable-5-2',
    background: true,
    fork: false,
  })
  await $.tool.call({ tool: 'Read', file_path: '/app/src/scanner.ts', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const title = await ui.find({ type: 'Text', text: /Find scanner code/ })
    expect(title?.text).toBe('🌓 🔭 Find scanner code')
    const tag = await ui.find({ type: 'Text', text: /Explore/ })
    expect(tag?.text).toMatch(/Explore · haiku-5-5 · 1 actions/)
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'Found it.',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const title = await ui.find({ type: 'Text', text: /Find scanner code/ })
  expect(title?.text).toBe('✦ 🔭 Find scanner code')
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('Clear finished')
  expect(toasts).toEqual(['✦ Find scanner code finished in 0s'])
  await ui.unmount()
})

test('the main agent shows task-list progress', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 1000 }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'One', status: 'completed', activeForm: 'Doing one' },
      { content: 'Two', status: 'in_progress', activeForm: 'Doing two' },
    ],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const bar = await ui.find({ type: 'Text', text: /of 2 steps/ })
  expect(bar?.text).toMatch(/1 of 2 steps/)
  await ui.unmount()
})

test('an empty session says so', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /No agents/ }))?.text).toBe('No agents yet')
  expect((await ui.find({ type: 'Text', text: /All quiet/ }))?.text).toContain('Helpers show up here')
  await ui.unmount()
})

test('a band above the prompt shows while a helper works, and goes when it is done', async ($, on) => {
  on('clock.now', () => ({ value: 1000 }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const BAND = { plugin: 'agent-watch', component: 'AbovePrompt', props: { hasSurvey: false }, surface: 'desktop' } as never

  const quiet = await $.ui.mount(BAND)
  expect((await quiet.find({ type: 'Text' }))?.text).toBe('engine')
  await quiet.unmount()

  await $.agent.spawn({
    prompt: 'Find the scanner code',
    description: 'Find scanner code',
    subagentType: 'Explore',
    tool_use_id: 'tu1',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-fable-5-2',
    background: true,
    fork: false,
  })
  await $.tool.call({ tool: 'Read', file_path: '/app/src/scanner.ts', agentId: 'a1' })

  const busy = await $.ui.mount(BAND)
  expect((await busy.find({ type: 'Text', text: /helper/ }))?.text).toBe('🌑 1 helper working')
  expect((await busy.find({ type: 'Button' }))?.props.label).toBe('Watch')
  await busy.unmount()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1', reason: 'answer' })
  const after = await $.ui.mount(BAND)
  expect((await after.find({ type: 'Text' }))?.text).toBe('engine')
  await after.unmount()
})
