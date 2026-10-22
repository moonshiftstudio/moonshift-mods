import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'studio-board',
  component: 'Pane',
  requestId: 'studio-board',
  props: { title: 'Moonshift Studio', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the board lists the apps and adds a to-do', async ($, on) => {
  mock.clock(on, { now: 1792600000000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/home/me/firefly-dash', surface: 'terminal', isInteractive: true })
  const added = await $.command.run({ command: 'todo', args: 'Make the App Store screenshots' })
  expect(added.text).toContain('Make the App Store screenshots')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Firefly Dash/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /you're here/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /App Store screenshots/ })).toBeDefined()
    await ui.unmount()
  }
})

test('where no panel can be drawn, /studio answers with the board as text', async ($, on) => {
  mock.clock(on, { now: 1792600000000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work/moonshiftstudio-site', surface: null, isInteractive: true })
  await $.command.run({ command: 'todo', args: 'Check the devlog dates' })
  const board = await $.command.run({ command: 'studio', args: '' })
  expect(board.text).toContain('**Website**: Live (you\'re here)')
  expect(board.text).toContain('- [ ] Check the devlog dates')
})
