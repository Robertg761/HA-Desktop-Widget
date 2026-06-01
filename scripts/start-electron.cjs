const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;
delete env.APPIMAGE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
