import { spawn } from 'node:child_process';

// Run from the workspace root after pnpm build. No extra process-manager dependency.
const commands = [
  ['examples/react-basic/dist/server.js'],
  [
    'examples/react-basic/node_modules/vite/bin/vite.js',
    '--config',
    'examples/react-basic/vite.config.ts',
    'examples/react-basic',
  ],
  [
    'examples/react-custom-ui/node_modules/vite/bin/vite.js',
    '--config',
    'examples/react-custom-ui/vite.config.ts',
    'examples/react-custom-ui',
  ],
];
const children = commands.map((args) =>
  spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
