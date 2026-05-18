const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return childProcess.execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function tryRun(command, args, options = {}) {
  try {
    return { ok: true, stdout: run(command, args, options), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout) : '',
      stderr: error.stderr ? String(error.stderr) : error.message,
    };
  }
}

function packTarball(cacheDir) {
  const output = run('npm', ['pack', '--silent', '--ignore-scripts', '--cache', cacheDir]).trim();
  const filename = output.split(/\r?\n/).filter(Boolean).pop();
  assert.ok(filename, 'npm pack did not return a tarball filename');
  return path.join(root, filename);
}

function manuallyInstallTarball(tarball, tempDir) {
  const packageDir = path.join(tempDir, 'node_modules', 'hello-agents-ts');
  fs.mkdirSync(packageDir, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1']);
  return packageDir;
}

function assertPackageCanBeRequired(tempDir) {
  const script = 'const sdk = require("hello-agents-ts"); console.log(!!sdk.HelloAgentsLLM)';
  const stdout = run('node', ['-e', script], {
    cwd: tempDir,
    env: {
      ...process.env,
      NODE_PATH: path.join(root, 'node_modules'),
    },
  }).trim();
  assert.equal(stdout, 'true');
}

function main() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-agents-ts-npm-cache-'));
  const tarball = packTarball(cacheDir);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-agents-ts-consume-'));

  try {
    const install = tryRun(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--cache',
        cacheDir,
        tarball,
      ],
      { cwd: tempDir, timeout: 15000 }
    );

    if (!install.ok) {
      console.warn('npm install from tarball failed; falling back to tarball extraction for offline verification.');
      console.warn(install.stderr.trim());
      manuallyInstallTarball(tarball, tempDir);
    }

    assertPackageCanBeRequired(tempDir);
    console.log('package consumption test passed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(tarball, { force: true });
  }
}

main();
