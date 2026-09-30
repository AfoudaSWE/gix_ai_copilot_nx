// Installation only prints the next step. It never edits the repository: setting GIX up is
// `npx gix init`, which runs the same way with npm, pnpm, yarn and bun (pnpm blocks
// dependency install scripts by default, and CI often uses --ignore-scripts).
if (!process.env.CI && process.env.npm_config_global !== 'true') {
  console.log('\n  @gixcopilot/sdk installed. Next: npx gix init   (detects your project; changes to your code are proposals you review)\n');
}
