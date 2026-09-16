import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = 'src';
const makefile = readFileSync('Makefile', 'utf-8');
const compose = readFileSync('docker-compose.yaml', 'utf-8');
const ciCompose = readFileSync('docker-compose.ci.override.yaml', 'utf-8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function topLevelBlock(text: string, name: string, indent: number): string[] {
  const lines = text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
  const start = lines.indexOf(`${' '.repeat(indent)}${name}:`);
  if (start === -1) return [];

  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && new RegExp(`^\\s{0,${indent}}\\S`).test(line)) break;
    block.push(line);
  }
  return block;
}

function workflowEnv(text: string): string[] {
  return topLevelBlock(text, 'env', 4).filter((line) => line.trim() !== '');
}

function normalizeMakeRecipe(lines: string[]): string[] {
  return lines
    .filter((line) => line.trim() !== '' && !/^\s*#/.test(line))
    .map((line) => line.trim().replace(/^[@-]+/, '').replace(/\s+/g, ' '));
}

function makeRecipe(text: string, target: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${target}\\s*:`).test(line));
  if (start === -1) return [];

  const recipe: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/.test(line) || /^\s+/.test(line)) recipe.push(line);
    else break;
  }
  return normalizeMakeRecipe(recipe);
}

const sources = walk(ROOT)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((file) => ({ file, text: readFileSync(file, 'utf-8') }));

describe('process-spawning invariants', () => {
  it('finds source files to check at all', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('never uses execSync/spawnSync/exec — those take a shell string', () => {
    const offenders = sources
      .filter((s) => /\b(?:execSync|spawnSync)\s*\(|(?<![\w.])exec\s*\(/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('never passes shell: true to a child process', () => {
    const offenders = sources
      .filter((s) => /shell\s*:\s*true/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('allows only the fixed ps argv lookup used for weekly lock ownership', () => {
    const calls: { file: string; snippet: string }[] = [];
    const staticArgv = /^execFileSync\(\s*['"][^'"]+['"]\s*,\s*\[/;
    const weeklyProcessIdentity = /^execFileSync\(\s*['"]ps['"]\s*,\s*\[\s*['"]-p['"]\s*,\s*String\(pid\)\s*,\s*['"]-o['"]\s*,\s*['"]lstart=['"]\s*\]\s*,\s*\{[^}]*timeout:\s*PROCESS_START_IDENTITY_TIMEOUT_MS[^}]*LC_ALL:\s*['"]C['"]/;
    for (const s of sources) {
      const re = /\bexecFileSync\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.text)) !== null) calls.push({ file: s.file, snippet: s.text.slice(m.index, m.index + 220) });
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(staticArgv.test(call.snippet) || weeklyProcessIdentity.test(call.snippet), `${call.file}: ${call.snippet}`).toBe(true);
    }
    expect("execFileSync('git', ['status'])").toMatch(staticArgv);
    expect("execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: PROCESS_START_IDENTITY_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C' })").toMatch(weeklyProcessIdentity);
    expect("execFileSync(command, ['-p', String(pid), '-o', 'lstart='])").not.toMatch(staticArgv);
    expect("execFileSync('ps', command)").not.toMatch(staticArgv);
    expect("execFileSync('ps -p ' + pid)").not.toMatch(staticArgv);
  });
});

describe('install invariants', () => {
  it('keeps test levels explicit and rejects no-op aliases', () => {
    expect(makefile).not.toMatch(/^test-(?:integration|e2e)\s*:/m);
    for (const target of ['test-unit', 'test-functional', 'test-acceptance', 'test-all']) {
      expect(makefile.split(/\r?\n/).some((line) => line.startsWith(`${target}:`)), `${target} target`).toBe(true);
    }
    const ciRecipe = makeRecipe(makefile, 'ci-test');
    expect(ciRecipe).toEqual([
      '$(MAKE) image',
      '$(MAKE) install',
      '$(MAKE) typecheck',
      '$(MAKE) test-unit',
      '$(MAKE) test-functional',
      '$(MAKE) acceptance-tui',
      '$(MAKE) build-all',
      '$(MAKE) release-daemon-lifecycle',
      '$(MAKE) smoke',
      '$(MAKE) test-distribution',
    ]);
    expect(ciRecipe.join('\n')).not.toContain('verify-distribution');
  });

  it('installs root and project-local dependencies in that order', () => {
    const installRecipe = makeRecipe(makefile, 'install');
    const rootInstall = '$(DC) run --rm --no-deps builder bun install --frozen-lockfile';
    const projectInstall = '$(DC) run --rm --no-deps --user 0:0 builder npm install --prefix .opencode --no-audit --no-fund';
    const rootInstallIndex = installRecipe.indexOf(rootInstall);
    const projectInstallIndex = installRecipe.indexOf(projectInstall);

    expect(installRecipe.length).toBeGreaterThan(0);
    expect(rootInstallIndex).toBeGreaterThanOrEqual(0);
    expect(projectInstallIndex).toBeGreaterThanOrEqual(0);
    expect(rootInstallIndex).toBeLessThan(projectInstallIndex);
  });

  it('declares the project-local dependency volume in the local compose', () => {
    expect(compose).toMatch(/^  opencode_node_modules:\s*$/m);
  });

  it('mounts project-local dependencies in local builder and test-runner services', () => {
    for (const service of ['builder', 'test-runner']) {
      const serviceBlock = topLevelBlock(compose, service, 2).join('\n');
      expect(serviceBlock, `${service} service block`).toContain('opencode_node_modules:/src/.opencode/node_modules');
    }
  });

  it('mounts project-local dependencies in CI builder and test-runner overrides', () => {
    for (const service of ['builder', 'test-runner']) {
      const serviceBlock = topLevelBlock(ciCompose, service, 2).join('\n');
      expect(serviceBlock, `${service} CI service block`).toContain('opencode_node_modules:/src/.opencode/node_modules');
    }
  });

  it('declares a job-specific CI project-local dependency volume', () => {
    const volumeBlock = topLevelBlock(ciCompose, 'opencode_node_modules', 2).join('\n');
    expect(volumeBlock).toContain('name: ocstatusline-opencode-node-modules-${CI_JOB_ID}');
  });

  it('keeps CI on the CI compose selection and release local-only', () => {
    expect(makefile).toMatch(/ifeq \(\$\(CI\),true\)[\s\S]*?DC := docker compose -f docker-compose\.yaml -f docker-compose\.ci\.override\.yaml/);
    const releaseRecipe = makeRecipe(makefile, 'release');
    expect(releaseRecipe).toEqual(expect.arrayContaining([
      '$(MAKE) test-unit',
      '$(MAKE) test-functional',
      '$(MAKE) test-distribution',
      '$(MAKE) verify-distribution',
    ]));
    expect(releaseRecipe.join('\n')).not.toMatch(/github|workflow|publish|upload/i);
  });

  it('uses an ephemeral host port for the CI mock while keeping the local port discoverable', () => {
    expect(makefile).toMatch(/MOCK_PORT\s+\?= 4096/);
    expect(makefile).toMatch(/ifeq \(\$\(CI\),true\)\s+MOCK_PORT := 0\s+endif/);
    expect(ciCompose).toContain('- "${MOCK_PORT:-0}:4096"');
    expect(compose).toContain('MOCK_PORT: "4096"');
    expect(compose).toContain('http://127.0.0.1:4096/healthz');
  });

  it('runs the native TUI acceptance gate from the .opencode module cwd before smoke and artifacts', () => {
    const acceptanceRecipe = makeRecipe(makefile, 'acceptance-tui');
    expect(acceptanceRecipe.some((line) => line.includes('timeout --foreground --kill-after='))).toBe(true);
    expect(makefile).toContain('$(DC) run --rm --no-deps --workdir /src/.opencode -v "$(GIT_COMMON_DIR):/git:ro" -e GIT_DIR="$(ACCEPTANCE_GIT_DIR)" -e GIT_WORK_TREE=/src test-runner timeout --foreground --kill-after=$(ACCEPTANCE_TUI_KILL_AFTER) $(ACCEPTANCE_TUI_TIMEOUT) bun run ../tests/tui/opentui.acceptance.ts');
    expect(makefile).toContain('OpenTUI acceptance exceeded $(ACCEPTANCE_TUI_TIMEOUT) wall-clock deadline');
    const ciRecipe = makeRecipe(makefile, 'ci-test');
    expect(ciRecipe.indexOf('$(MAKE) acceptance-tui')).toBeLessThan(ciRecipe.indexOf('$(MAKE) smoke'));
    expect(ciRecipe.indexOf('$(MAKE) build-all')).toBeLessThan(ciRecipe.indexOf('$(MAKE) release-daemon-lifecycle'));
    expect(ciRecipe.indexOf('$(MAKE) release-daemon-lifecycle')).toBeLessThan(ciRecipe.indexOf('$(MAKE) smoke'));
    const releaseRecipe = makeRecipe(makefile, 'release');
    expect(releaseRecipe.indexOf('$(MAKE) acceptance-tui')).toBeGreaterThanOrEqual(0);
    expect(releaseRecipe.indexOf('$(MAKE) acceptance-tui')).toBeLessThan(releaseRecipe.indexOf('$(MAKE) smoke'));
    expect(releaseRecipe.indexOf('$(MAKE) acceptance-tui')).toBeLessThan(releaseRecipe.indexOf('$(MAKE) verify-distribution'));
  });

  it('keeps the distribution contract before the external release verifier', () => {
    const releaseRecipe = makeRecipe(makefile, 'release');
    expect(releaseRecipe.indexOf('$(MAKE) test-distribution')).toBeGreaterThanOrEqual(0);
    expect(releaseRecipe.indexOf('$(MAKE) verify-distribution')).toBeGreaterThanOrEqual(0);
    expect(releaseRecipe.indexOf('$(MAKE) test-distribution')).toBeLessThan(releaseRecipe.indexOf('$(MAKE) verify-distribution'));
    const ciRecipe = makeRecipe(makefile, 'ci-test');
    expect(ciRecipe.indexOf('$(MAKE) test-distribution')).toBeGreaterThanOrEqual(0);
    expect(ciRecipe.join('\n')).not.toContain('verify-distribution');
    expect(makefile).toContain('ci-test: ## What CI runs: hermetic mandatory gates in order (external distribution verification is release-only)');
    expect(makefile).toContain('test-distribution: ## Run the hermetic contract test for the distribution wrapper');
    expect(makefile).toContain('verify-distribution: build-all');
    expect(makefile).toContain('bash scripts/verify-distribution.sh');
  });
});
