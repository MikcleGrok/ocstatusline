import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = 'src';
const makefile = readFileSync('Makefile', 'utf-8');
const compose = readFileSync('docker-compose.yaml', 'utf-8');
const ciCompose = readFileSync('docker-compose.ci.override.yaml', 'utf-8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf-8');
const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf-8');

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
      .filter((s) => /\b(execSync|spawnSync|[^F]\bexec)\s*\(/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('never passes shell: true to a child process', () => {
    const offenders = sources
      .filter((s) => /shell\s*:\s*true/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('calls execFileSync only with an argv array as its second argument', () => {
    const calls: { file: string; snippet: string }[] = [];
    for (const s of sources) {
      const re = /execFileSync\(\s*([^)]{0,200})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.text)) !== null) calls.push({ file: s.file, snippet: m[1] });
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.snippet, `${call.file}: ${call.snippet}`).toMatch(/^['"][^'"]+['"]\s*,\s*\[/);
    }
  });
});

describe('install invariants', () => {
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

  it('keeps CI and release workflows on the CI compose selection', () => {
    expect(makefile).toMatch(/ifeq \(\$\(CI\),true\)[\s\S]*?DC := docker compose -f docker-compose\.yaml -f docker-compose\.ci\.override\.yaml/);
    expect(ciWorkflow).toMatch(/^\s*run: make ci-test\s*$/m);
    const releaseJob = topLevelBlock(releaseWorkflow, 'release', 2).join('\n');
    expect(workflowEnv(releaseJob).join('\n')).toMatch(/^\s+CI:\s*true\s*$/m);
    expect(releaseJob).toMatch(/^\s+- name: Build every target, run the gates, write the manifest\s*$[\s\S]*?^\s+run: make release\s*$/m);
  });
});
