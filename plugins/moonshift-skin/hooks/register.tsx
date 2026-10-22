import type { Register } from 'claude-code'

// Moonshift Studio colors
const GOLD = '#E5B24C'

// Which Moonshift project a folder belongs to, by a folder name anywhere in its path.
const PROJECTS: { match: RegExp; name: string; color: string }[] = [
  { match: /(^|[\\/])firefly-dash([\\/]|$)/i, name: 'Firefly Dash', color: '#C6F24E' },
  { match: /(^|[\\/])(manatable|commander-table)([\\/]|$)/i, name: 'Manatable', color: '#E7C77A' },
  { match: /(^|[\\/])unbadged[^\\/]*([\\/]|$)/i, name: 'Unbadged', color: '#FF7C30' },
  { match: /(^|[\\/])nopehook[^\\/]*([\\/]|$)/i, name: 'Nopehook', color: '#F07020' },
  { match: /(^|[\\/])moonshiftstudio-site([\\/]|$)/i, name: 'Website', color: GOLD },
  { match: /(^|[\\/])moonshift[^\\/]*([\\/]|$)/i, name: 'Studio', color: GOLD },
]

// Words for the spinner while Claude works, one picked per turn.
const WORDS = [
  'Clocking in',
  'Running freight',
  'Zoning the aisles',
  'Burning the midnight oil',
  'Working the night shift',
  'Building between shifts',
  'Chasing fireflies',
  'Shuffling the deck',
  'Sniffing out scams',
  'Polishing pixels',
  'Following the moon',
  'Pulling a double',
]

function projectFor(cwd: string) {
  return PROJECTS.find(p => p.match.test(cwd))
}

function formatDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m}m ${rest}s` : `${m}m`
}

export const register: Register = on => {
  // Module variables reset on reload; that only changes which word shows next.
  let turn = 0
  let project: ReturnType<typeof projectFor>

  on('session.start', async ($, e, next) => {
    project = projectFor(e.cwd)
    const result = await next(e)
    if (e.isInteractive) {
      $.ui.toast(project ? `Moonshift Studio · ${project.name}` : 'Moonshift Studio')
    }
    return result
  })

  on('prompt.submit', ($, e, next) => {
    turn += 1
    return next(e)
  })

  // Night-shift words on the spinner. On the desktop the word says what the step
  // is doing, so it is left alone there.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null) return next(e)
    return next({ ...e, props: { ...e.props, word: WORDS[turn % WORDS.length] ?? 'Working' } })
  })

  // "Shift done · 12s" in gold where the turn's closing line goes.
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.props.isExpanded || e.props.waitingFor) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text color={GOLD}>
        ☾ Shift done · {formatDuration(e.props.durationMs)}
      </Text>
    )
  })

  // The project you're in, at the right of the prompt footer.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const here = project ?? projectFor(await $.session.cwd())
    if (!here) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} · </Text>}
        <Text color={here.color}>☾ {here.name}</Text>
      </Box>
    )
  })
}
