# Install with an AI agent

Let your coding agent (Claude Code, Cursor, GitHub Copilot agent mode, Codex, Windsurf, …) add
the copilot to your app for you, with you in the loop. Copy the prompt below into the agent,
from the root of your repository. The agent first **reads your repository without changing
anything**, reports what it found and proposes a plan, and then **stops for your approval**
before every step that changes files or installs packages.

It uses the same installer as [Installation](installation.md) (`@gixcopilot/create`), so the
result is identical to running it yourself: nothing is overwritten, and the model API key stays
on the server.

## How it works

| Step | What the agent does | Changes files? | Needs your approval |
| --- | --- | --- | --- |
| 1. Inspect | Reads `package.json`, lockfiles, framework and bundler config, Node version, git status | No | No |
| 2. Plan | Reports its findings and the exact command and files it proposes | No | **Yes** |
| 3. Dry run | Runs the installer with `--dry-run` and shows you the output | No | **Yes** |
| 4. Install | Runs the installer for real | Yes | (approved in 3) |
| 5. Wire up | Shows the diff to render the chat panel where you chose | Yes | **Yes** |
| 6. Verify | Builds, runs tests, starts the copilot server | No | No |
| 7. Summary | Lists every file added or changed and what you do next | No | No |

You can answer "change X" at any checkpoint; the agent revises the plan and asks again.

## The prompt

```text
You are adding the GIX AI Copilot SDK (npm scope @gixcopilot) to this repository.
Documentation: https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/docs/guides
Work in the phases below. I am the human in the loop: at every STOP, show me what you
found or propose, then wait for my explicit answer. Do not continue on your own.

RULES (apply to every phase)
- Never overwrite or delete an existing file, and never change unrelated code.
- Never commit, push, or change git history unless I ask.
- Never write, print or guess an API key or other secret. Real keys go only in the
  server's .env file, which I fill in myself.
- Do not install any package other than the ones the installer adds, unless I approve it.
- Do not disable lint rules, type checks or tests to make something pass.
- If an install, build, test or write command fails, stop, show me the error and propose a
  fix. Do not retry blindly.
- Inspect only the repository on disk (the current working directory). Ignore files that are
  open in the editor or mentioned in context but live outside it.

PHASE 1 - INSPECT (read-only; run no install or write commands)
In this phase a missing file, an empty search or a failed read-only command is a finding,
not an error: note it (for example "no copilot-server/ folder") and keep going. Do not stop
to ask; the first stop is Phase 2.
Find out and note:
1. Which app to install into. If this is a monorepo/workspace, list the apps and which one
   looks like the user-facing frontend.
2. The frontend framework from package.json dependencies: React, Vue, Angular, Next.js, or
   none (backend-only). Note TypeScript vs JavaScript and the source folder (src/ or app/).
3. The bundler/config file: vite.config.*, angular.json or next.config.*.
4. The package manager from the lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock,
   bun.lockb).
5. The Node.js version (`node --version`); the SDK needs Node 22.12 or newer.
6. Anything already present: @gixcopilot/* dependencies, a copilot-server/ folder,
   a src/copilot/ folder, an /api/copilot route or proxy, something already using port 4000.
7. Whether .env files are git-ignored.
8. `git status`: are there uncommitted changes?

PHASE 2 - PLAN -> STOP
Report the findings above in a short list. Then propose:
- the app directory to install into,
- the exact installer command (see below),
- where the copilot server will go (default: copilot-server/),
- which page or layout should render the chat panel (ask me if unclear),
- anything that blocks the install (Node too old, unsupported framework, name clashes)
  and how you would resolve it.
If there are uncommitted changes, suggest that I commit or create a branch first.
STOP and wait for my approval or changes.

The installer command (non-interactive, because I approve in this chat instead):
  npx -y @gixcopilot/create@latest --yes --framework <react|vue|angular|none> --pm <npm|pnpm|yarn|bun>
Add --server-dir <dir> if copilot-server/ is taken, --no-server if I already have a
backend and only want the UI. Run it from the app directory.
For Next.js, the installer adds the React UI and the separate copilot server, and prints an
/api/copilot rewrite for next.config instead of patching it. Offer me two options: keep the
separate server and add that rewrite, or host the API inside Next.js (then pass --no-server)
following https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/nextjs.md

PHASE 3 - DRY RUN -> STOP
Run the approved command with --dry-run added. Show me its full output: every file it will
add, every file it will patch, every command it will run. STOP and wait for my approval.

PHASE 4 - INSTALL
Run the same command without --dry-run. Show the output. If it reports that a file already
exists and was skipped, tell me which one.

PHASE 5 - WIRE UP -> STOP
The installer adds the chat component but does not place it in my UI. Show me the exact diff
that renders it in the page or layout I chose:
- React: import { CopilotPanel } from './copilot/CopilotPanel'; then <CopilotPanel />
- Vue: import CopilotPanel from './copilot/CopilotPanel.vue'; then <CopilotPanel />
- Angular: add CopilotPanelComponent (./copilot-panel.component) to a component's imports,
  then <app-copilot-panel />
- Next.js: also the next.config rewrite, or the route handler from the Next.js guide.
STOP and wait for my approval, then apply exactly that diff.

PHASE 6 - VERIFY
1. Confirm .env files are git-ignored and that no API key appears in any frontend file.
2. Build the frontend app with its existing build script.
3. In the server directory: build and run its tests (npm run build && npm test, or the
   package-manager equivalent).
4. Start the server (npm run copilot:server from the app, http://127.0.0.1:4000) and confirm it
   starts without errors, then stop it.
Without OPENAI_API_KEY the server answers with a clearly labelled mock model; that is expected.
Report each result. If anything fails, STOP and propose a fix.

PHASE 7 - SUMMARY
List every file added and every file changed, then tell me:
- to put OPENAI_API_KEY=... in <server-dir>/.env for real answers,
- how to run it: npm run copilot:server, then the app's dev server,
- next steps: give the copilot abilities with `npx aicopilot add tool <name>` in the server
  directory, and the guides for context, tools and security.
```

## What to expect

- **Nothing changes before your first approval.** Phases 1 and 2 only read files.
- **The dry run is the contract.** The real install does exactly what the dry run showed; the
  installer never overwrites a file that already exists.
- **Secrets stay with you.** The agent is told never to write or print a key. You add
  `OPENAI_API_KEY` to the server's `.env` yourself; the browser never sees it.
- **Works without a key.** Until you add one, the server answers with a labelled mock model, so
  you can check the whole flow first.

## Supported setups

React, Vue and Angular apps (Vite or Angular CLI), with npm, pnpm, yarn or bun, on Node 22.12+.
For Next.js, the agent offers the separate copilot server with a rewrite, or the
[Next.js guide](nextjs.md) route. For anything else, the agent says so in Phase 2 and proposes
the [manual install](installation.md#install-packages-yourself).

> [!SECURITY]
> Review each diff the agent shows you before approving it, as you would a pull request. The
> prompt forbids commits and pushes, so every change stays in your working tree until you
> commit it yourself.

## Next

- [Quickstart](getting-started.md): what the installer sets up, step by step.
- [Tools](tools.md): give the copilot actions in your app, behind the Action Firewall.
- [Security](security.md): authentication, permissions and approvals before production.
