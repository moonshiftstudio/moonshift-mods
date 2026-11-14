# Moonshift Mods

Claude Code mods for working on Moonshift Studio apps.

| Mod | What it does |
| --- | --- |
| **studio-board** | `/studio` opens a side panel with Nopehook, Unbadged, Firefly Dash, Manatable and the website: each one's status and links (live app, repo, Vercel), the studio links, and a to-do list that stays between sessions. `/todo <text>` adds a to-do from the prompt. |
| **secret-guard** | Stops Claude from writing secret keys (Supabase service_role or secret keys, OpenAI, Anthropic, Stripe, AWS, GitHub tokens, private keys) into code, and checks every `git add`, `git commit` and `git push` for them. `.env` files can hold secrets only when git ignores them. Public keys meant to ship in apps, like Supabase anon or publishable keys, pass. |
| **moonshift-skin** | Night-shift words on the spinner, a gold "Shift done" line at the end of each turn, and the app you're working on (by its folder name) in its brand color at the right of the prompt footer. |
| **agent-watch** | `/agent-watch` opens a side panel with a card for the main Claude and every helper agent: a moon that turns through its phases while the agent works, what it is doing right now in plain words, its last few actions, its model, how many actions it has taken, how long it has run, and a gold progress bar (steps done when the agent keeps a task list). A one-line band above the prompt shows while helpers are working, and a note pops up when one finishes. `/agent-watch calm` stops the motion and the notes; `/agent-watch lively` brings them back. |
| **token-saver** | Three ways to spend fewer tokens. Built-in helper agents that only search or read run on Haiku and general helpers on Sonnet, unless the call names a model (never an upgrade, and forks, planning and other plugins' agents are left alone). Claude is asked to take browser screenshots at 60% size, about a third of the tokens (the call itself is never rewritten, so auto mode does not check it twice). `/handoff` writes a note that carries a long chat into a fresh one, and a nudge says when a chat is long enough to be worth it. `/saver` shows what each part did and switches it on or off. |

Mods run in Claude Code 2.1.287 or newer, in the terminal and in the desktop app's Code tab.

## Install

At the prompt of a terminal session:

```
/plugin install studio-board --marketplace moonshiftstudio/moonshift-mods
/plugin install secret-guard --marketplace moonshiftstudio/moonshift-mods
/plugin install moonshift-skin --marketplace moonshiftstudio/moonshift-mods
/plugin install agent-watch --marketplace moonshiftstudio/moonshift-mods
/plugin install token-saver --marketplace moonshiftstudio/moonshift-mods
```

Answer `y` to add the marketplace the first time, then pick the user scope so the mods load in every session.

From a shell:

```
claude plugin install studio-board --marketplace moonshiftstudio/moonshift-mods
claude plugin install secret-guard --marketplace moonshiftstudio/moonshift-mods
claude plugin install moonshift-skin --marketplace moonshiftstudio/moonshift-mods
claude plugin install agent-watch --marketplace moonshiftstudio/moonshift-mods
claude plugin install token-saver --marketplace moonshiftstudio/moonshift-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `moonshiftstudio/moonshift-mods`, then Add plugin for each one.

## Updating the studio list

The apps, links and statuses on the board are in `plugins/studio-board/hooks/register.tsx` (`APPS` and `STUDIO_LINKS`). Edit them, push, then run `claude plugin update studio-board` and `/reload-plugins`.
