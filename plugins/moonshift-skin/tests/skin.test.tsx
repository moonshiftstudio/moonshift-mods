import { expect, test } from 'claude-code/testing'

test('shift-done line and the project in the footer', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: 'C:\\Users\\me\\Moonshift\\firefly-dash', surface: 'terminal', isInteractive: true })

  const line = await $.ui.mount({ plugin: 'moonshift-skin', surface: 'terminal', component: 'TurnDuration', requestId: 't1', props: { word: 'Baked', durationMs: 64000 } })
  expect((await line.find({ type: 'Text', text: /Shift done/ }))?.text).toBe('☾ Shift done · 1m 4s')
  await line.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const footer = await $.ui.mount({ plugin: 'moonshift-skin', surface, component: 'SessionMode', requestId: 'm', props: { modes: [] } })
    expect(await footer.find({ type: 'Text', text: /Firefly Dash/ })).toBeDefined()
    await footer.unmount()
  }
})
