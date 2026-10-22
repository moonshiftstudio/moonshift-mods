import type { Register } from 'claude-code'

// What counts as a secret. Public keys that are meant to ship in apps (Supabase
// publishable/anon keys, a Firebase web key) are not listed, so they pass.
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { kind: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { kind: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/ },
  { kind: 'Stripe secret key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{60,}/ },
  { kind: 'Google service account key', re: /"type"\s*:\s*"service_account"/ },
  { kind: 'Slack token', re: /\bxox[abpors]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Resend API key', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/ },
  { kind: 'Vercel token', re: /\bvercel_[A-Za-z0-9]{24,}/ },
]
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g

// .env files hold secrets; examples and templates are fine to commit.
const ENV_FILE = /(^|[\\/])\.env(\.[A-Za-z0-9_-]+)?$/
const ENV_OK = /\.(example|sample|template|dist)$/i

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function decodeBase64Url(s: string) {
  let bits = 0
  let value = 0
  let out = ''
  for (const ch of s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')) {
    const n = B64.indexOf(ch)
    if (n < 0) continue
    value = (value << 6) | n
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((value >> bits) & 0xff)
    }
  }
  return out
}

/** The kinds of secret in a piece of text (never the secret itself). */
function findSecrets(text: string): string[] {
  const kinds = new Set<string>()
  for (const p of PATTERNS) if (p.re.test(text)) kinds.add(p.kind)
  for (const m of text.matchAll(JWT)) {
    if (/"role"\s*:\s*"service_role"/.test(decodeBase64Url(m[1] ?? ''))) kinds.add('Supabase service_role key')
  }
  return [...kinds]
}

function isEnvFile(path: string) {
  return ENV_FILE.test(path) && !ENV_OK.test(path)
}

function dirOf(path: string) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : '.'
}

/** Where a shell command runs git: a leading `cd <dir> &&` or `git -C <dir>`. */
function gitDir(command: string): string | undefined {
  const cd = command.match(/^\s*cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*(&&|;)/)
  const dashC = command.match(/\bgit\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/)
  const m = dashC ?? cd
  return m ? m[2] ?? m[3] ?? m[4] : undefined
}

type Finding = { file: string; kinds: string[] }

/** Walk a unified diff and report, per file, the secrets in its added lines and any .env file. */
function scanDiff(diff: string): Finding[] {
  const found = new Map<string, Set<string>>()
  let file = ''
  const add = (f: string, kind: string) => {
    if (!found.has(f)) found.set(f, new Set())
    found.get(f)!.add(kind)
  }
  let added: string[] = []
  const flush = () => {
    if (file && added.length) for (const k of findSecrets(added.join('\n'))) add(file, k)
    added = []
  }
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      flush()
      file = line.slice(4).replace(/^b\//, '').trim()
      if (file !== '/dev/null' && isEnvFile(file)) add(file, '.env file')
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push(line.slice(1))
    }
  }
  flush()
  return [...found].map(([f, kinds]) => ({ file: f, kinds: [...kinds] }))
}

function describe(findings: Finding[]) {
  return findings
    .slice(0, 8)
    .map(f => `${f.file} (${f.kinds.join(', ')})`)
    .join('; ')
}

export const register: Register = on => {
  // 1. Writing a secret into a file
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const text = e.tool === 'Write' ? e.content : e.new_string
    const kinds = findSecrets(text)
    const path = e.file_path

    if (isEnvFile(path)) {
      // A .env file may hold secrets, as long as git ignores it.
      const dir = dirOf(path)
      const inRepo = await $.process.run(['git', 'rev-parse', '--is-inside-work-tree'], { cwd: dir })
      if (inRepo.exitCode === 0) {
        const ignored = await $.process.run(['git', 'check-ignore', '-q', path], { cwd: dir })
        if (ignored.exitCode !== 0) {
          $.ui.toast('Secret Guard: add .env to .gitignore first')
          return { deny: `Secret Guard: ${path} is not ignored by git, so its secrets could be committed. Add .env (and .env.*) to .gitignore first, then write it.` }
        }
      }
      return next(e)
    }

    if (kinds.length) {
      $.ui.toast(`Secret Guard blocked a ${kinds[0]} in ${path.split(/[\\/]/).pop()}`)
      return {
        deny: `Secret Guard: this would put a ${kinds.join(' and ')} into ${path}. Keep secrets in a gitignored .env file (or the host's environment variables) and read them from there. Don't paste the value into code.`,
      }
    }
    return next(e)
  }).catch(($, e, next) => {
    $.ui.toast('Secret Guard could not check this file')
    return next(e)
  })

  // 2. Committing or pushing a secret
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command
    if (!/\bgit\b/.test(cmd)) return next(e)
    const isCommit = /\bgit\b[^;&|]*\bcommit\b/.test(cmd)
    const isPush = /\bgit\b[^;&|]*\bpush\b/.test(cmd)
    const isAdd = /\bgit\b[^;&|]*\badd\b/.test(cmd)
    if (!isCommit && !isPush && !isAdd) return next(e)

    const cwd = gitDir(cmd)
    const git = (args: string[]) => $.process.run(['git', ...args], cwd ? { cwd } : {})
    if ((await git(['rev-parse', '--is-inside-work-tree'])).exitCode !== 0) return next(e)

    let findings: Finding[] = []

    // Force-adding an ignored .env file
    if (isAdd && /\s(-f|--force)\b/.test(cmd) && /\.env\b/.test(cmd) && !/\.env\.(example|sample|template)/.test(cmd)) {
      findings.push({ file: '.env', kinds: ['force-adding an ignored .env file'] })
    }

    if (isCommit || isAdd) {
      // What will be in the commit: staged changes, plus everything tracked and new when
      // the same command stages more (git add, commit -a).
      const stagesMore = isAdd || /\bcommit\b[^;&|]*\s-(a|[a-z]*a[a-z]*)\b|--all\b/.test(cmd)
      const diff = await git(['diff', stagesMore ? 'HEAD' : '--cached', '--no-color', '-U0'])
      findings.push(...scanDiff(diff.stdout))
      if (stagesMore) {
        const untracked = await git(['ls-files', '--others', '--exclude-standard'])
        for (const f of untracked.stdout.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 300)) {
          if (isEnvFile(f)) {
            findings.push({ file: f, kinds: ['.env file that is not in .gitignore'] })
            continue
          }
          try {
            const full = cwd ? `${cwd}/${f}` : f
            const stat = await $.fs.stat(full)
            if ((stat as { size?: number }).size && (stat as { size: number }).size > 512 * 1024) continue
            const text = await $.fs.read(full)
            const kinds = findSecrets(typeof text === 'string' ? text : '')
            if (kinds.length) findings.push({ file: f, kinds })
          } catch {
            // unreadable (binary, gone): skip
          }
        }
      }
    }

    if (isPush) {
      // Commits that no remote has yet
      const log = await git(['log', '-p', '--no-color', '-U0', '--max-count=50', 'HEAD', '--not', '--remotes'])
      findings.push(...scanDiff(log.stdout))
    }

    // One line per file
    const merged = new Map<string, Set<string>>()
    for (const f of findings) {
      if (!merged.has(f.file)) merged.set(f.file, new Set())
      for (const k of f.kinds) merged.get(f.file)!.add(k)
    }
    findings = [...merged].map(([file, kinds]) => ({ file, kinds: [...kinds] }))

    if (findings.length) {
      $.ui.toast(`Secret Guard stopped a ${isPush ? 'push' : 'commit'}: ${findings.length} file${findings.length > 1 ? 's' : ''} with secrets`)
      return {
        deny: `Secret Guard: secrets found in ${describe(findings)}. Move them to a gitignored .env file or the host's environment variables, unstage the file (git restore --staged <file>), and if a secret was already committed, rewrite that commit before pushing and rotate the key. Tell the person which files and kinds of secret were found, never the values.`,
      }
    }
    return next(e)
  }).catch(($, e, next) => {
    $.ui.toast('Secret Guard could not check this git command')
    return next.called ? next(e) : next(e)
  })
}
