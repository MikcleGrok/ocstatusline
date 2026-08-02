import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  collectPluginAssetsFromDisk,
  isRepoCheckoutNotFoundError,
  resolveConfigDir,
  rewritePluginImports,
  runTuiInstall,
  runTuiInstallWithEmbeddedFallback,
  type EmbeddedPluginSource,
  type PluginAssetFile,
  type TuiInstallOptions,
} from '../../src/tui/install.js';
import { PLUGIN_ASSET_FILES, REQUIRED_PACKAGE_JSON_DEPENDENCIES, REQUIRED_PACKAGE_JSON_SCALARS } from '../../src/tui/embedded-plugin-assets.generated.js';
import { collectEmbeddedPluginAssets, GENERATED_FILE_RELATIVE, renderEmbeddedPluginAssetsModule } from '../../scripts/generate-tui-plugin-assets.js';

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

// Exactly what src/index.ts hands in when it has no repo checkout to read
// from: the plugin source baked into the binary.
const EMBEDDED_SOURCE: EmbeddedPluginSource = { assets: PLUGIN_ASSET_FILES, dependencies: REQUIRED_PACKAGE_JSON_DEPENDENCIES, scalars: REQUIRED_PACKAGE_JSON_SCALARS };

// The embedded (standalone-binary) counterpart of install().
function installEmbedded(options: Partial<TuiInstallOptions> = {}) {
  return runTuiInstall({ configDir, skipNpmInstall: true, embedded: EMBEDDED_SOURCE, ...options });
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

  it('keeps the footer regions on one non-wrapping row', () => {
    const pluginSource = readFileSync(join(REPO_ROOT, '.opencode/tui-plugins/ocstatusline.ts'), 'utf-8');
    expect(pluginSource).toContain("width: '100%', paddingLeft: 1, flexDirection: 'row', flexWrap: 'no-wrap', overflow: 'hidden'");
    expect(pluginSource).toContain("flexGrow: align === 'center' ? 1 : 0, flexShrink: align === 'center' ? 1 : 0, overflow: 'hidden'");
    expect(pluginSource).toContain("fg: 'gray', wrapMode: 'none', children: ' · '");
    expect(pluginSource).toContain("fg: segment.color, wrapMode: 'none', children: segment.text");
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

const CLOSURE_RELATIVE_PATHS = ['src/tui/footer.ts', 'src/tui/openrouter.ts', 'src/data/git.ts', 'src/data/openrouter-weekly.ts', 'src/types/index.ts', 'src/utils/config.ts'];

describe('runTuiInstall embedded (standalone-binary) mode', () => {
  it('writes the same file closure as the disk mode, without any repo checkout', async () => {
    const result = await installEmbedded();

    for (const relativePath of ['tui-plugins/ocstatusline.ts', ...CLOSURE_RELATIVE_PATHS]) {
      const absolute = join(configDir, relativePath);
      expect(existsSync(absolute), `expected ${absolute} to exist`).toBe(true);
      expect(result.copiedFiles).toContain(absolute);
    }
    expect(result.copiedFiles).toHaveLength(CLOSURE_RELATIVE_PATHS.length + 1);
  });

  it('writes byte-identical content to what a source-mode install copies', async () => {
    await installEmbedded();

    const entryOnDisk = readFileSync(join(REPO_ROOT, '.opencode/tui-plugins/ocstatusline.ts'), 'utf-8');
    expect(readFileSync(join(configDir, 'tui-plugins/ocstatusline.ts'), 'utf-8')).toBe(rewritePluginImports(entryOnDisk));
    for (const relativePath of CLOSURE_RELATIVE_PATHS) {
      expect(readFileSync(join(configDir, relativePath), 'utf-8'), `content mismatch for ${relativePath}`).toBe(readFileSync(join(REPO_ROOT, relativePath), 'utf-8'));
    }
  });

  it('never touches the filesystem the repo would live on: succeeds with a repoRoot that does not exist', async () => {
    // The compiled binary's repoRoot resolves inside Bun's virtual embedded
    // filesystem and contains none of this repo's files -- the guard that
    // rejects that must not run at all once assets are supplied.
    const result = await installEmbedded({ repoRoot: join(tmpdir(), 'definitely-not-an-ocstatusline-checkout') });
    expect(result.source).toBe('embedded');
    expect(existsSync(join(configDir, 'tui-plugins/ocstatusline.ts'))).toBe(true);
  });

  it('reports source/repoRoot per mode', async () => {
    expect(await installEmbedded()).toMatchObject({ source: 'embedded', repoRoot: null });
    expect(await install()).toMatchObject({ source: 'disk', repoRoot: REPO_ROOT });
  });

  it('seeds package.json with the embedded dependency pins and scalar fields', async () => {
    const result = await installEmbedded();
    expect(result.packageJsonCreated).toBe(true);
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toEqual(JSON.parse(readFileSync(join(REPO_ROOT, '.opencode/package.json'), 'utf-8')).dependencies);
  });

  it('merges into an existing package.json without clobbering another plugin pin', async () => {
    writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies: { 'solid-js': '0.0.1-some-other-plugin-pin' } }, null, 2));

    const result = await installEmbedded();
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, 'utf-8'));
    expect(pkg.dependencies['solid-js']).toBe('0.0.1-some-other-plugin-pin');
    expect(pkg.dependencies['@opentui/core']).toBeTypeOf('string');
    expect(pkg.type).toBe('module');
  });

  it('registers the plugin in tui.json and stays idempotent, including across a mode switch', async () => {
    const first = await installEmbedded();
    expect(first.tuiJsonCreated).toBe(true);
    expect(first.pluginAlreadyRegistered).toBe(false);

    const second = await install();
    expect(second.pluginAlreadyRegistered).toBe(true);
    const tuiJson = JSON.parse(readFileSync(second.tuiJsonPath, 'utf-8'));
    expect(tuiJson.plugin).toEqual(['./tui-plugins/ocstatusline.ts']);
  });

  it('still refuses to register the plugin when npm install fails', async () => {
    await expect(
      installEmbedded({
        skipNpmInstall: false,
        npmInstall: async () => {
          throw new Error('simulated ENETUNREACH');
        },
      }),
    ).rejects.toThrow(/npm install failed.*simulated ENETUNREACH/s);
    expect(existsSync(join(configDir, 'tui.json'))).toBe(false);
  });
});

describe('embedded plugin assets, as generated', () => {
  it('is in sync with the plugin source in the repo (regenerate with `make generate-tui-plugin-assets`)', () => {
    const expected = renderEmbeddedPluginAssetsModule(collectEmbeddedPluginAssets(REPO_ROOT));
    const committed = readFileSync(join(REPO_ROOT, GENERATED_FILE_RELATIVE), 'utf-8');
    expect(committed, `${GENERATED_FILE_RELATIVE} is stale -- run \`make generate-tui-plugin-assets\``).toBe(expected);
  });

  it('carries the plugin entry with its imports already rewritten for configDir', () => {
    const entry = PLUGIN_ASSET_FILES.find((asset) => asset.relativePath === 'tui-plugins/ocstatusline.ts');
    expect(entry).toBeDefined();
    expect(entry?.content).not.toContain("'../../src/");
    expect(entry?.content).toContain("from '../src/tui/footer.js'");
  });

  it('carries the full dependency closure and nothing else', () => {
    expect(PLUGIN_ASSET_FILES.map((asset) => asset.relativePath)).toEqual(['tui-plugins/ocstatusline.ts', ...CLOSURE_RELATIVE_PATHS]);
  });
});

describe('isRepoCheckoutNotFoundError', () => {
  // src/index.ts retries the install with the embedded assets on exactly this
  // error and no other -- a broader catch would mask a real failure behind a
  // confusing second attempt.
  it('is true for the missing-checkout guard', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'ocsl-fake-repo-'));
    try {
      const error = await install({ repoRoot: fakeRepoRoot }).then(
        () => null,
        (err: unknown) => err,
      );
      expect(isRepoCheckoutNotFoundError(error)).toBe(true);
    } finally {
      rmSync(fakeRepoRoot, { recursive: true, force: true });
    }
  });

  it('is false for an npm install failure', async () => {
    const error = await install({ skipNpmInstall: false, npmInstall: async () => { throw new Error('simulated ENETUNREACH'); } }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(isRepoCheckoutNotFoundError(error)).toBe(false);
  });

  it('is false for a malformed tui.json', async () => {
    writeFileSync(join(configDir, 'tui.json'), '{ this is not valid json');
    const error = await install().then(
      () => null,
      (err: unknown) => err,
    );
    expect(isRepoCheckoutNotFoundError(error)).toBe(false);
  });

  it('is false for unrelated values', () => {
    expect(isRepoCheckoutNotFoundError(new Error('boom'))).toBe(false);
    expect(isRepoCheckoutNotFoundError(undefined)).toBe(false);
    expect(isRepoCheckoutNotFoundError('OCSL_REPO_CHECKOUT_NOT_FOUND')).toBe(false);
  });

  it('classifies a path component that is a file (ENOTDIR) as "no checkout"', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'ocsl-notdir-repo-'));
    try {
      // .opencode is a file, so stat'ing .opencode/tui-plugins/... fails with
      // ENOTDIR rather than ENOENT -- still just "there is no checkout here".
      writeFileSync(join(fakeRepoRoot, '.opencode'), 'not a directory');
      const error = await install({ repoRoot: fakeRepoRoot }).then(
        () => null,
        (err: unknown) => err,
      );
      expect(isRepoCheckoutNotFoundError(error)).toBe(true);
    } finally {
      rmSync(fakeRepoRoot, { recursive: true, force: true });
    }
  });

  // root ignores permission bits, so the unreadable directory would simply be
  // readable and the test would prove nothing.
  const notRoot = process.getuid === undefined || process.getuid() !== 0;
  it.skipIf(!notRoot)('surfaces a permission error instead of silently calling a real checkout "missing"', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'ocsl-eacces-repo-'));
    const pluginDir = join(fakeRepoRoot, '.opencode', 'tui-plugins');
    try {
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'ocstatusline.ts'), '// a real checkout, just unreadable\n');
      chmodSync(pluginDir, 0o000);

      const error = await install({ repoRoot: fakeRepoRoot }).then(
        () => null,
        (err: unknown) => err,
      );
      // Must NOT be swallowed as "no checkout": that would answer a broken
      // permission setup with a silent embedded install from the binary.
      expect(isRepoCheckoutNotFoundError(error)).toBe(false);
      expect((error as NodeJS.ErrnoException).code).toBe('EACCES');
    } finally {
      chmodSync(pluginDir, 0o755);
      rmSync(fakeRepoRoot, { recursive: true, force: true });
    }
  });
});

// Repo convention: TS sources import each other through a '.js' specifier
// that resolves to the sibling '.ts' file.
function resolveAssetImport(fromRelativePath: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromRelativePath), specifier)).replace(/\.js$/, '.ts');
}

function importSpecifiers(content: string): string[] {
  return [...content.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

// Both sets must hold: the one baked into the binary, and the one a source
// install reads off the checkout right now. The second is what turns a
// newly-added import into an immediately red test, before anyone regenerates.
const ASSET_SETS: Array<{ label: string; load: () => PluginAssetFile[] }> = [
  { label: 'baked into the binary', load: () => PLUGIN_ASSET_FILES },
  { label: 'collected from the checkout', load: () => collectPluginAssetsFromDisk(REPO_ROOT) },
];

// Relative imports that point at a file no asset in the set provides -- i.e.
// files the installed plugin would try to import out of a configDir where
// they were never written.
function danglingRelativeImports(assets: PluginAssetFile[]): string[] {
  const known = new Set(assets.map((asset) => asset.relativePath));
  const dangling: string[] = [];
  for (const asset of assets) {
    for (const specifier of importSpecifiers(asset.content)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveAssetImport(asset.relativePath, specifier);
      if (!known.has(resolved)) dangling.push(`${asset.relativePath} imports '${specifier}' -> ${resolved}, which no asset provides`);
    }
  }
  return dangling;
}

function relativeImportCount(assets: PluginAssetFile[]): number {
  return assets.reduce((total, asset) => total + importSpecifiers(asset.content).filter((specifier) => specifier.startsWith('.')).length, 0);
}

// Bare imports that are neither a node builtin nor pinned in
// <configDir>/package.json -- i.e. packages npm install would never fetch.
function unpinnedPackageImports(assets: PluginAssetFile[], pinned: Record<string, string>): string[] {
  const unpinned: string[] = [];
  for (const asset of assets) {
    for (const specifier of importSpecifiers(asset.content)) {
      if (specifier.startsWith('.')) continue;
      const name = packageNameOf(specifier);
      if (builtinModules.includes(name.replace(/^node:/, ''))) continue;
      if (!(name in pinned)) unpinned.push(`${asset.relativePath} imports '${specifier}', which nothing pins in <configDir>/package.json`);
    }
  }
  return unpinned;
}

describe('plugin asset set is self-contained', () => {
  for (const { label, load } of ASSET_SETS) {
    // The failure this catches: someone adds `import { x } from
    // '../data/session.js'` to a file in the closure, regenerates (the drift
    // check stays green -- the *content* is in sync), ships, and every
    // Homebrew user's install writes a plugin importing a file that was never
    // copied. Only walking the actual import graph sees it.
    it(`resolves every relative import to another asset in the same set (${label})`, () => {
      const assets = load();
      expect(danglingRelativeImports(assets)).toEqual([]);
      // Guards the regex itself: a match-nothing pattern would make the
      // assertion above vacuously true.
      expect(relativeImportCount(assets)).toBeGreaterThanOrEqual(8);
    });

    it(`imports no package beyond the node builtins and the pinned dependencies (${label})`, () => {
      expect(unpinnedPackageImports(load(), REQUIRED_PACKAGE_JSON_DEPENDENCIES)).toEqual([]);
    });
  }

  // Both checks above are only worth anything if they can fail.
  it('flags a relative import that leaves the set', () => {
    const broken: PluginAssetFile[] = [
      { relativePath: 'tui-plugins/ocstatusline.ts', content: "import { a } from '../src/tui/footer.js';\n" },
      { relativePath: 'src/tui/footer.ts', content: "import { b } from '../data/session.js';\n" },
    ];
    expect(danglingRelativeImports(broken)).toEqual(["src/tui/footer.ts imports '../data/session.js' -> src/data/session.ts, which no asset provides"]);
  });

  it('flags a package import nothing pins', () => {
    const broken: PluginAssetFile[] = [{ relativePath: 'src/tui/footer.ts', content: "import { basename } from 'node:path';\nimport { z } from 'zod';\n" }];
    expect(unpinnedPackageImports(broken, { 'solid-js': '1.9.12' })).toEqual(["src/tui/footer.ts imports 'zod', which nothing pins in <configDir>/package.json"]);
  });
});

describe('runTuiInstallWithEmbeddedFallback', () => {
  // A stand-in for the binary's baked-in copy that is impossible to confuse
  // with the disk install: if the embedded path runs, this marker file lands
  // in configDir.
  const POISON: EmbeddedPluginSource = { assets: [{ relativePath: 'embedded-marker.txt', content: 'the embedded path ran\n' }], dependencies: {}, scalars: {} };
  const markerPath = () => join(configDir, 'embedded-marker.txt');

  it('uses the checkout and never touches the embedded copy when the disk install succeeds', async () => {
    const npmCalls: string[] = [];
    const result = await runTuiInstallWithEmbeddedFallback(POISON, { repoRoot: REPO_ROOT, configDir, npmInstall: async (dir) => void npmCalls.push(dir) });

    expect(result.source).toBe('disk');
    expect(existsSync(markerPath())).toBe(false);
    expect(npmCalls).toEqual([configDir]);
  });

  it('retries with the embedded copy when there is no checkout, and returns that result', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'ocsl-fake-repo-'));
    try {
      const result = await runTuiInstallWithEmbeddedFallback(POISON, { repoRoot: fakeRepoRoot, configDir, skipNpmInstall: true });

      expect(result.source).toBe('embedded');
      expect(result.repoRoot).toBeNull();
      expect(readFileSync(markerPath(), 'utf-8')).toBe('the embedded path ran\n');
    } finally {
      rmSync(fakeRepoRoot, { recursive: true, force: true });
    }
  });

  it('propagates an npm install failure instead of retrying it as an embedded install', async () => {
    await expect(
      runTuiInstallWithEmbeddedFallback(POISON, {
        repoRoot: REPO_ROOT,
        configDir,
        npmInstall: async () => {
          throw new Error('simulated ENETUNREACH');
        },
      }),
    ).rejects.toThrow(/npm install failed.*simulated ENETUNREACH/s);

    expect(existsSync(markerPath())).toBe(false);
  });

  it('propagates a malformed tui.json instead of retrying it as an embedded install', async () => {
    writeFileSync(join(configDir, 'tui.json'), '{ this is not valid json');

    await expect(runTuiInstallWithEmbeddedFallback(POISON, { repoRoot: REPO_ROOT, configDir, skipNpmInstall: true })).rejects.toThrow(/not valid JSON/);
    expect(existsSync(markerPath())).toBe(false);
  });
});
