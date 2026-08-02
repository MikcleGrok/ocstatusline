import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The dependency closure of .opencode/tui-plugins/ocstatusline.ts, verified by
// hand: every repo-internal file it imports, directly or transitively. Keep
// this in sync with the plugin's own imports -- tests/tui/install.test.ts
// checks that every copy target actually exists on disk after a real repo
// checkout, which catches drift the moment a new import is added upstream
// without this list being updated.
//
// The plugin entry point does not keep the exact same relative layout once
// copied: in the repo it lives two directories below the repo root
// (repoRoot/.opencode/tui-plugins/ocstatusline.ts) and its own imports climb
// back up with '../../src/...'. The global OpenCode config dir plays the
// role of the project's .opencode/ directory (its tui.json's own "plugin"
// entry is resolved the same way, relative to the directory that contains
// tui.json), so the copied plugin entry lives one directory below configDir,
// not two -- configDir/tui-plugins/ocstatusline.ts. Its '../../src/...'
// imports are rewritten to '../src/...' during the copy (see
// rewritePluginImports below) to match that one-directory-shallower nesting.
// The dependency files underneath keep their exact src/... layout and their
// mutual relative imports, so they need no rewriting.
const PLUGIN_ENTRY_SRC_RELATIVE = '.opencode/tui-plugins/ocstatusline.ts';
const PLUGIN_ENTRY_DEST_RELATIVE = 'tui-plugins/ocstatusline.ts';
const PLUGIN_TUI_JSON_ENTRY = './tui-plugins/ocstatusline.ts';

const DEPENDENCY_CLOSURE_RELATIVE = ['src/tui/footer.ts', 'src/tui/openrouter.ts', 'src/data/git.ts', 'src/data/openrouter-weekly.ts', 'src/types/index.ts', 'src/utils/config.ts'];

const PACKAGE_JSON_SRC_RELATIVE = '.opencode/package.json';
// Non-dependency scalar fields .opencode/package.json pins today (private,
// type) that must also be ensured on an *existing* global package.json, not
// just seeded when creating a fresh one -- a merge that only fills in
// dependencies but drops "type": "module" would leave the global config
// running under the wrong module system.
const PACKAGE_JSON_REQUIRED_SCALAR_FIELDS = ['private', 'type'] as const;

export interface TuiInstallOptions {
  repoRoot?: string;
  configDir?: string;
  skipNpmInstall?: boolean;
  // Overrides the real `npm install --prefix <configDir> ...` call. Tests use
  // this to exercise the failure-handling path deterministically instead of
  // depending on a real npm failure.
  npmInstall?: (configDir: string) => Promise<void>;
}

export interface TuiInstallResult {
  repoRoot: string;
  configDir: string;
  copiedFiles: string[];
  tuiJsonPath: string;
  tuiJsonCreated: boolean;
  pluginAlreadyRegistered: boolean;
  packageJsonPath: string;
  packageJsonCreated: boolean;
  npmInstallRan: boolean;
}

function resolveRepoRoot(override?: string): string {
  if (override) return override;
  // This module lives at <repoRoot>/src/tui/install.ts. import.meta.dir is a
  // Bun-specific extension (this repo is Bun-only, so that is expected), but
  // it does not survive vitest/Vite's module transform even when vitest
  // itself runs under real Bun -- verified directly: `bun run` on a one-line
  // probe script prints import.meta.dir fine, the identical property read
  // through `bunx vitest` is undefined. That is a test-runner limitation,
  // not a production one, which is exactly why options.repoRoot exists: real
  // callers (the CLI) never pass it and get the live import.meta.dir value;
  // tests always pass it and never touch import.meta.dir at all.
  return join(import.meta.dir, '..', '..');
}

export function resolveConfigDir(override?: string): string {
  if (override) return override;
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) return join(xdgConfigHome, 'opencode');
  return join(homedir(), '.config', 'opencode');
}

// A `bun build --compile` standalone binary has no real filesystem to read
// the plugin source from: import.meta.dir resolves inside Bun's virtual
// embedded filesystem (/$bunfs/root), so repoRoot collapses to something
// that looks plausible but contains none of this repo's files. Fail fast
// with a clear message instead of a bare ENOENT deep inside a copy step.
function assertRepoRootLooksReal(repoRoot: string): void {
  const pluginEntryPath = join(repoRoot, PLUGIN_ENTRY_SRC_RELATIVE);
  if (!existsSync(pluginEntryPath)) {
    throw new Error(
      `ocstatusline install: ${pluginEntryPath} does not exist. ` +
        'This command only works when run from a checked-out copy of the ocstatusline repo ' +
        '(dev/source mode: `bun run src/index.ts install`, or the Docker toolchain) -- ' +
        'not from the compiled standalone binary, which has no real filesystem to read the plugin source from.',
    );
  }
}

// Turns the plugin entry's repo-root-relative imports into configDir-relative
// ones -- see the big comment above DEPENDENCY_CLOSURE_RELATIVE for why this
// rewrite is necessary rather than a byte-for-byte copy.
function rewritePluginImports(source: string): string {
  return source.replaceAll("'../../src/", "'../src/");
}

function copyPluginEntry(repoRoot: string, configDir: string): string {
  const src = join(repoRoot, PLUGIN_ENTRY_SRC_RELATIVE);
  const dest = join(configDir, PLUGIN_ENTRY_DEST_RELATIVE);
  const contents = readFileSync(src, 'utf-8');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, rewritePluginImports(contents), 'utf-8');
  return dest;
}

function copyDependency(repoRoot: string, configDir: string, relativePath: string): string {
  const src = join(repoRoot, relativePath);
  const dest = join(configDir, relativePath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src, 'utf-8'), 'utf-8');
  return dest;
}

// Parses a JSON file and requires its top level to be a plain object.
// Malformed JSON or a non-object top level (a bare array, string, number...)
// throws a clear error instead of being silently treated as empty -- for a
// file the user may have hand-edited (tui.json especially), silently
// discarding whatever was actually there would be a worse outcome than
// failing loudly.
function readJsonObject(path: string, label: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`ocstatusline install: ${label} at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`ocstatusline install: ${label} at ${path} must be a JSON object at the top level, found ${Array.isArray(parsed) ? 'an array' : typeof parsed}`);
  }
  return parsed as Record<string, unknown>;
}

// Writes JSON atomically: serialize to a sibling temp file, then rename over
// the target. A rename on the same filesystem is atomic, so an interruption
// mid-write (crash, kill -9, disk full) always leaves either the old file or
// the fully-written new one -- never a truncated half-write. This matters
// most for tui.json, which can carry a large hand-written keybinds block
// that took real effort to set up and has no other backup.
function writeJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.${basename(path)}.ocstatusline-install-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, path);
}

function mergePackageJson(repoRoot: string, configDir: string): { path: string; created: boolean } {
  const sourcePackageJson = readJsonObject(join(repoRoot, PACKAGE_JSON_SRC_RELATIVE), '.opencode/package.json');
  const sourceDeps = sourcePackageJson.dependencies;
  const requiredDeps = (sourceDeps && typeof sourceDeps === 'object' && !Array.isArray(sourceDeps) ? sourceDeps : {}) as Record<string, string>;

  const destPath = join(configDir, 'package.json');
  const created = !existsSync(destPath);
  const data: Record<string, unknown> = created ? {} : readJsonObject(destPath, 'package.json');

  // Ensure required scalar fields (private, type) are present without
  // overwriting anything already set, on both the create and the merge path.
  for (const field of PACKAGE_JSON_REQUIRED_SCALAR_FIELDS) {
    if (data[field] === undefined && field in sourcePackageJson) data[field] = sourcePackageJson[field];
  }

  if (data.dependencies !== undefined && (typeof data.dependencies !== 'object' || data.dependencies === null || Array.isArray(data.dependencies))) {
    throw new Error(`ocstatusline install: package.json at ${destPath} has a non-object "dependencies" field`);
  }
  const existingDeps = (data.dependencies ?? {}) as Record<string, string>;
  // Existing pins win: never clobber a version another plugin/tool already
  // pinned for a shared dependency (e.g. a different solid-js version some
  // other plugin depends on) -- only fill in whatever is missing.
  data.dependencies = { ...requiredDeps, ...existingDeps };

  writeJsonAtomic(destPath, data);
  return { path: destPath, created };
}

function mergeTuiJson(configDir: string): { path: string; created: boolean; alreadyRegistered: boolean } {
  const path = join(configDir, 'tui.json');
  const created = !existsSync(path);
  const data: Record<string, unknown> = created ? { $schema: 'https://opencode.ai/tui.json' } : readJsonObject(path, 'tui.json');

  let plugins: unknown[];
  if (data.plugin === undefined) {
    plugins = [];
  } else if (Array.isArray(data.plugin)) {
    plugins = [...data.plugin];
  } else {
    throw new Error(`ocstatusline install: tui.json at ${path} has a non-array "plugin" field`);
  }
  const alreadyRegistered = plugins.includes(PLUGIN_TUI_JSON_ENTRY);
  if (!alreadyRegistered) plugins.push(PLUGIN_TUI_JSON_ENTRY);
  data.plugin = plugins;

  writeJsonAtomic(path, data);
  return { path, created, alreadyRegistered };
}

// Installs the OpenCode TUI plugin (.opencode/tui-plugins/ocstatusline.ts and
// its dependency closure) into the global OpenCode config dir so it loads for
// every project on this machine, not just when OpenCode is launched from
// inside this repo's checkout.
//
// Scope: this assumes the ocstatusline repo's own src/ and .opencode/
// directories are present on disk relative to this module (dev/source mode:
// `bun run src/index.ts install`, or the Docker toolchain) -- see
// assertRepoRootLooksReal above for the standalone-binary case. See
// README.md's "Экспериментальный TUI adapter" section for the long version
// of that limitation.
//
// Every step here is safe to re-run: file copies overwrite in place, the
// package.json/tui.json writes are atomic (see writeJsonAtomic) and their
// merges are idempotent, and tui.json is only updated after npm install has
// actually succeeded, so a failed install never registers a plugin whose
// dependencies are not actually there.
export async function runTuiInstall(options: TuiInstallOptions = {}): Promise<TuiInstallResult> {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  assertRepoRootLooksReal(repoRoot);
  const configDir = resolveConfigDir(options.configDir);
  mkdirSync(configDir, { recursive: true });

  const copiedFiles: string[] = [copyPluginEntry(repoRoot, configDir)];
  for (const relativePath of DEPENDENCY_CLOSURE_RELATIVE) copiedFiles.push(copyDependency(repoRoot, configDir, relativePath));

  const { path: packageJsonPath, created: packageJsonCreated } = mergePackageJson(repoRoot, configDir);

  let npmInstallRan = false;
  if (!options.skipNpmInstall) {
    const runNpmInstall =
      options.npmInstall ??
      (async (dir: string) => {
        await execFileAsync('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund']);
      });
    try {
      await runNpmInstall(configDir);
      npmInstallRan = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`ocstatusline install: npm install failed in ${configDir}: ${message}`);
    }
  }

  const { path: tuiJsonPath, created: tuiJsonCreated, alreadyRegistered: pluginAlreadyRegistered } = mergeTuiJson(configDir);

  return { repoRoot, configDir, copiedFiles, tuiJsonPath, tuiJsonCreated, pluginAlreadyRegistered, packageJsonPath, packageJsonCreated, npmInstallRan };
}
