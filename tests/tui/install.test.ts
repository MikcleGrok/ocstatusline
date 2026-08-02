import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfigDir, runTuiInstall, type TuiInstallOptions } from '../../src/tui/install.js';

// tests/tui/install.test.ts -> repo root is two directories up. Resolved via
// the standard import.meta.url + fileURLToPath dance (same convention as
// tests/mock/mock-opencode.ts) rather than Bun's import.meta.dir: unlike
// production code, this file must run cleanly under vitest, and
// import.meta.dir does not survive vitest's module transform even under
// real Bun (see the comment on resolveRepoRoot in src/tui/install.ts).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Real temp dirs on disk, cleaned up after every test -- never touch the
// developer's actual ~/.config/opencode.
let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'ocsl-install-'));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

// runTuiInstall always pinned to the real repo root and a temp configDir --
// every call below spreads in extra options (e.g. skipNpmInstall) on top.
function install(options: Partial<TuiInstallOptions> = {}) {
  return runTuiInstall({ repoRoot: REPO_ROOT, configDir, skipNpmInstall: true, ...options });
}

describe('runTuiInstall file copy', () => {
  it('copies the plugin entry point and its full dependency closure under configDir', async () => {
    const result = await install();

    const expectedRelativePaths = [
      'tui-plugins/ocstatusline.ts',
      'src/tui/footer.ts',
      'src/tui/openrouter.ts',
      'src/data/git.ts',
      'src/data/openrouter-weekly.ts',
      'src/types/index.ts',
      'src/utils/config.ts',
    ];
    for (const relativePath of expectedRelativePaths) {
      const absolute = join(configDir, relativePath);
      expect(existsSync(absolute), `expected ${absolute} to exist`).toBe(true);
      expect(result.copiedFiles).toContain(absolute);
    }
    expect(result.copiedFiles).toHaveLength(expectedRelativePaths.length);
  });

  it('rewrites the copied plugin entry so its relative imports resolve inside configDir', async () => {
    await install();

    const pluginSource = readFileSync(join(configDir, 'tui-plugins/ocstatusline.ts'), 'utf-8');
    expect(pluginSource).not.toContain("'../../src/");
    expect(pluginSource).toContain("from '../src/tui/footer.js'");
    expect(pluginSource).toContain("from '../src/data/openrouter-weekly.js'");
    expect(pluginSource).toContain("from '../src/tui/openrouter.js'");
    expect(pluginSource).toContain("from '../src/utils/config.js'");

    // The rewritten specifiers must actually resolve to real copied files,
    // matching what node's relative-import resolution would do starting
    // from tui-plugins/ocstatusline.ts.
    for (const relative of ['../src/tui/footer.js', '../src/data/openrouter-weekly.js', '../src/tui/openrouter.js', '../src/utils/config.js']) {
      const resolvedTsPath = join(configDir, 'tui-plugins', relative).replace(/\.js$/, '.ts');
      expect(existsSync(resolvedTsPath), `expected ${resolvedTsPath} to exist`).toBe(true);
    }
  });

  it('does not run npm install when skipNpmInstall is set', async () => {
    const result = await install();
    expect(result.npmInstallRan).toBe(false);
    expect(existsSync(join(configDir, 'node_modules'))).toBe(false);
  });

  it('rejects when repoRoot does not look like a real ocstatusline checkout (standalone-binary guard)', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'ocsl-fake-repo-'));
    try {
      await expect(install({ repoRoot: fakeRepoRoot })).rejects.toThrow(/checked-out copy/);
    } finally {
      rmSync(fakeRepoRoot, { recursive: true, force: true });
    }
  });

  it('runs the injected npmInstall hook and surfaces a clear error when it fails', async () => {
    await expect(
      install({
        skipNpmInstall: false,
        npmInstall: async () => {
          throw new Error('simulated ENETUNREACH');
        },
      }),
    ).rejects.toThrow(/npm install failed.*simulated ENETUNREACH/s);

    // Must fail before registering the plugin -- tui.json is untouched.
    expect(existsSync(join(configDir, 'tui.json'))).toBe(false);
  });

  it('runs the injected npmInstall hook and proceeds to register the plugin on success', async () => {
    const calledWith: string[] = [];
    const result = await install({
      skipNpmInstall: false,
      npmInstall: async (dir) => {
        calledWith.push(dir);
      },
    });
    expect(calledWith).toEqual([configDir]);
    expect(result.npmInstallRan).toBe(true);
    expect(result.pluginAlreadyRegistered).toBe(false);
  });
});

describe('runTuiInstall package.json merge', () => {
  it('writes package.json with the required dependency pins when none exists', async () => {
    const result = await install();
    expect(result.packageJsonCreated).toBe(true);
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toMatchObject({
      '@opencode-ai/plugin': expect.any(String),
      '@opentui/core': expect.any(String),
      '@opentui/keymap': expect.any(String),
      '@opentui/solid': expect.any(String),
      'solid-js': expect.any(String),
    });
  });

  it('merges required deps into an existing package.json without clobbering unrelated fields', async () => {
    writeFileSync(join(configDir, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'some-other-pkg': '1.0.0' } }, null, 2));

    const result = await install();
    expect(result.packageJsonCreated).toBe(false);
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.dependencies['some-other-pkg']).toBe('1.0.0');
    expect(pkg.dependencies['solid-js']).toBeTypeOf('string');
  });

  it('ensures "private" and "type" are set on an existing package.json that is missing them, not just on create', async () => {
    writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies: {} }, null, 2));

    const result = await install();
    expect(result.packageJsonCreated).toBe(false);
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
  });

  it('does not overwrite an existing "private"/"type" value that already differs from the source', async () => {
    writeFileSync(join(configDir, 'package.json'), JSON.stringify({ private: false, type: 'commonjs', dependencies: {} }, null, 2));

    const result = await install();
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.private).toBe(false);
    expect(pkg.type).toBe('commonjs');
  });

  it('does not clobber an existing version pin for a dependency shared with another plugin', async () => {
    writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies: { 'solid-js': '0.0.1-some-other-plugin-pin' } }, null, 2));

    const result = await install();
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.dependencies['solid-js']).toBe('0.0.1-some-other-plugin-pin');
    // Still fills in whatever else was missing.
    expect(pkg.dependencies['@opentui/core']).toBeTypeOf('string');
  });

  it('rejects a package.json whose "dependencies" field is not an object', async () => {
    writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies: ['not', 'an', 'object'] }, null, 2));
    await expect(install()).rejects.toThrow(/non-object "dependencies"/);
  });

  it('writes package.json atomically: no leftover temp file after a successful install', async () => {
    await install();
    const leftovers = readdirSync(configDir).filter((name) => name.includes('.ocstatusline-install-'));
    expect(leftovers).toEqual([]);
  });
});

describe('runTuiInstall tui.json merge', () => {
  it('creates tui.json with the plugin entry when none exists', async () => {
    const result = await install();
    expect(result.tuiJsonCreated).toBe(true);
    expect(result.pluginAlreadyRegistered).toBe(false);

    const tuiJson = JSON.parse(readFileSync(result.tuiJsonPath, 'utf-8'));
    expect(tuiJson.$schema).toBe('https://opencode.ai/tui.json');
    expect(tuiJson.plugin).toEqual(['./tui-plugins/ocstatusline.ts']);
  });

  it('preserves existing unrelated top-level keys such as keybinds', async () => {
    const existing = {
      $schema: 'https://opencode.ai/tui.json',
      keybinds: { app_exit: 'ctrl+c,ctrl+d', theme_list: ['alt+t'] },
    };
    writeFileSync(join(configDir, 'tui.json'), `${JSON.stringify(existing, null, 2)}\n`);

    const result = await install();
    expect(result.tuiJsonCreated).toBe(false);

    const tuiJson = JSON.parse(readFileSync(result.tuiJsonPath, 'utf-8'));
    expect(tuiJson.keybinds).toEqual(existing.keybinds);
    expect(tuiJson.plugin).toEqual(['./tui-plugins/ocstatusline.ts']);
  });

  it('preserves existing plugin entries and appends without duplicating', async () => {
    const existing = { $schema: 'https://opencode.ai/tui.json', plugin: ['./tui-plugins/some-other-plugin.ts'] };
    writeFileSync(join(configDir, 'tui.json'), `${JSON.stringify(existing, null, 2)}\n`);

    const result = await install();
    const tuiJson = JSON.parse(readFileSync(result.tuiJsonPath, 'utf-8'));
    expect(tuiJson.plugin).toEqual(['./tui-plugins/some-other-plugin.ts', './tui-plugins/ocstatusline.ts']);
  });

  it('is idempotent across repeated installs: no duplicate plugin entry, no key reordering surprises', async () => {
    await install();
    const second = await install();
    expect(second.tuiJsonCreated).toBe(false);
    expect(second.pluginAlreadyRegistered).toBe(true);

    const tuiJson = JSON.parse(readFileSync(second.tuiJsonPath, 'utf-8'));
    expect(tuiJson.plugin).toEqual(['./tui-plugins/ocstatusline.ts']);
  });

  it('ends with a trailing newline, matching the existing tui.json style', async () => {
    const result = await install();
    const raw = readFileSync(result.tuiJsonPath, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.endsWith('\n\n')).toBe(false);
  });

  it('handles an empty (zero-byte) existing tui.json file by writing a fresh plugin entry', async () => {
    writeFileSync(join(configDir, 'tui.json'), '');

    const result = await install();
    expect(result.tuiJsonCreated).toBe(false);
    const tuiJson = JSON.parse(readFileSync(result.tuiJsonPath, 'utf-8'));
    expect(tuiJson.plugin).toEqual(['./tui-plugins/ocstatusline.ts']);
  });

  it('rejects malformed (unparseable) JSON in an existing tui.json instead of silently discarding it', async () => {
    writeFileSync(join(configDir, 'tui.json'), '{ this is not valid json');
    await expect(install()).rejects.toThrow(/not valid JSON/);
  });

  it('rejects a tui.json whose top-level value is not an object', async () => {
    writeFileSync(join(configDir, 'tui.json'), JSON.stringify(['just', 'an', 'array']));
    await expect(install()).rejects.toThrow(/must be a JSON object/);
  });

  it('rejects a tui.json whose "plugin" field exists but is not an array', async () => {
    writeFileSync(join(configDir, 'tui.json'), JSON.stringify({ $schema: 'https://opencode.ai/tui.json', plugin: './tui-plugins/x.ts' }));
    await expect(install()).rejects.toThrow(/non-array "plugin"/);
  });

  it('writes tui.json atomically: no leftover temp file after a successful install', async () => {
    await install();
    const leftovers = readdirSync(configDir).filter((name) => name.includes('.ocstatusline-install-'));
    expect(leftovers).toEqual([]);
  });
});

describe('resolveConfigDir', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it('honors an explicit override regardless of XDG_CONFIG_HOME', () => {
    process.env.XDG_CONFIG_HOME = '/should/be/ignored';
    expect(resolveConfigDir('/explicit/config/dir')).toBe('/explicit/config/dir');
  });

  it('resolves under XDG_CONFIG_HOME/opencode when the env var is set', () => {
    process.env.XDG_CONFIG_HOME = '/xdg/config/home';
    expect(resolveConfigDir()).toBe(join('/xdg/config/home', 'opencode'));
  });

  it('falls back to ~/.config/opencode when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(resolveConfigDir()).toBe(join(homedir(), '.config', 'opencode'));
  });
});
