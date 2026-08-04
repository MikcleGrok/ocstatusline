import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
export const PLUGIN_ENTRY_SRC_RELATIVE = '.opencode/tui-plugins/ocstatusline.ts';
export const PLUGIN_ENTRY_DEST_RELATIVE = 'tui-plugins/ocstatusline.ts';
const PLUGIN_TUI_JSON_ENTRY = './tui-plugins/ocstatusline.ts';

export const DEPENDENCY_CLOSURE_RELATIVE = ['src/tui/footer.ts', 'src/tui/openrouter.ts', 'src/data/git.ts', 'src/data/openrouter-weekly.ts', 'src/data/project-status.ts', 'src/types/index.ts', 'src/utils/config.ts'];

export const PACKAGE_JSON_SRC_RELATIVE = '.opencode/package.json';
// Non-dependency scalar fields .opencode/package.json pins today (private,
// type) that must also be ensured on an *existing* global package.json, not
// just seeded when creating a fresh one -- a merge that only fills in
// dependencies but drops "type": "module" would leave the global config
// running under the wrong module system.
export const PACKAGE_JSON_REQUIRED_SCALAR_FIELDS = ['private', 'type'] as const;

// One file to write under configDir: its configDir-relative destination path
// plus the exact bytes to write there (already import-rewritten, for the
// plugin entry). Both install modes produce this same shape -- the disk mode
// reads it off a real checkout, the embedded mode gets it handed in from
// src/tui/embedded-plugin-assets.generated.ts -- so everything downstream of
// the read is a single code path.
export interface PluginAssetFile {
  relativePath: string;
  content: string;
}

// Everything an install needs when there is no checkout to read it from,
// as one indivisible value. Deliberately not three independent options: a
// caller that passed the assets but forgot the dependency pins would produce
// a plugin that installs cleanly, registers itself in tui.json, npm-installs
// nothing, and then fails to load inside OpenCode -- silent and miserable to
// diagnose. The type makes that combination unrepresentable.
export interface EmbeddedPluginSource {
  assets: PluginAssetFile[];
  // Dependency pins to merge into <configDir>/package.json.
  dependencies: Record<string, string>;
  // Non-dependency fields to ensure there too (private, type) -- see
  // PACKAGE_JSON_REQUIRED_SCALAR_FIELDS.
  scalars: Record<string, unknown>;
}

export interface TuiInstallOptions {
  repoRoot?: string;
  configDir?: string;
  skipNpmInstall?: boolean;
  // Overrides the real `npm install --prefix <configDir> ...` call. Tests use
  // this to exercise the failure-handling path deterministically instead of
  // depending on a real npm failure.
  npmInstall?: (configDir: string) => Promise<void>;
  // Embedded (standalone-binary) mode. When supplied, the repo checkout is
  // never touched: no assertRepoRootLooksReal, no disk reads, no repoRoot at
  // all -- this value is the whole source of truth for what gets written. The
  // compiled binary passes the constants generated into
  // src/tui/embedded-plugin-assets.generated.ts; a checked-out repo passes
  // nothing and keeps the original disk-read behaviour byte for byte.
  embedded?: EmbeddedPluginSource;
}

export interface TuiInstallResult {
  // 'disk' = read out of a real repo checkout, 'embedded' = taken from the
  // assets compiled into the standalone binary.
  source: 'disk' | 'embedded';
  // null in embedded mode: there is no repo checkout behind the install.
  repoRoot: string | null;
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

// Thrown by assertRepoRootLooksReal, and *only* by it: it is the one failure
// the caller is allowed to answer by retrying in embedded mode (see
// src/index.ts). Every other failure -- a broken npm install, malformed JSON,
// a permission error -- must keep propagating as itself, or a retry would
// mask a real problem behind a confusing second error. The `code` field makes
// the check survive any bundling/instance weirdness that could defeat a bare
// instanceof.
export const REPO_CHECKOUT_NOT_FOUND_CODE = 'OCSL_REPO_CHECKOUT_NOT_FOUND';

export class RepoCheckoutNotFoundError extends Error {
  readonly code = REPO_CHECKOUT_NOT_FOUND_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'RepoCheckoutNotFoundError';
  }
}

export function isRepoCheckoutNotFoundError(err: unknown): err is RepoCheckoutNotFoundError {
  if (err instanceof RepoCheckoutNotFoundError) return true;
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === REPO_CHECKOUT_NOT_FOUND_CODE;
}

// A `bun build --compile` standalone binary has no real filesystem to read
// the plugin source from: import.meta.dir resolves inside Bun's virtual
// embedded filesystem (/$bunfs/root), so repoRoot collapses to something
// that looks plausible but contains none of this repo's files. Fail fast
// with a clear, *recognisable* error instead of a bare ENOENT deep inside a
// copy step -- the compiled binary catches exactly this one and retries with
// its embedded copy of the plugin source.
//
// statSync rather than existsSync on purpose: existsSync answers false for
// *any* failure, EACCES included, so an unreadable but perfectly real
// checkout would be misreported as "no checkout" and silently answered with
// the baked-in copy instead of the permission error the developer needs to
// see. Only "it genuinely is not there" (ENOENT, or ENOTDIR when a path
// component is a file) means no checkout; everything else propagates as
// itself.
function assertRepoRootLooksReal(repoRoot: string): void {
  const pluginEntryPath = join(repoRoot, PLUGIN_ENTRY_SRC_RELATIVE);
  try {
    statSync(pluginEntryPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    throw new RepoCheckoutNotFoundError(
      `ocstatusline install: ${pluginEntryPath} does not exist. ` +
        'This command only works when run from a checked-out copy of the ocstatusline repo ' +
        '(dev/source mode: `bun run src/index.ts install`, or the Docker toolchain) -- ' +
        'not from the compiled standalone binary, which has no real filesystem to read the plugin source from.',
    );
  }
}

// Turns the plugin entry's repo-root-relative imports into configDir-relative
// ones -- see the big comment above DEPENDENCY_CLOSURE_RELATIVE for why this
// rewrite is necessary rather than a byte-for-byte copy. Exported so
// scripts/generate-tui-plugin-assets.ts applies the identical rewrite when it
// bakes the plugin entry into the binary, instead of duplicating the rule.
export function rewritePluginImports(source: string): string {
  return source.replaceAll("'../../src/", "'../src/");
}

// Reads the plugin entry + its dependency closure off a real checkout into
// the same PluginAssetFile[] shape the embedded mode hands in directly.
export function collectPluginAssetsFromDisk(repoRoot: string): PluginAssetFile[] {
  const entry: PluginAssetFile = {
    relativePath: PLUGIN_ENTRY_DEST_RELATIVE,
    content: rewritePluginImports(readFileSync(join(repoRoot, PLUGIN_ENTRY_SRC_RELATIVE), 'utf-8')),
  };
  // The dependency files keep their exact src/... layout and their mutual
  // relative imports, so their content is copied verbatim.
  const dependencies = DEPENDENCY_CLOSURE_RELATIVE.map((relativePath) => ({ relativePath, content: readFileSync(join(repoRoot, relativePath), 'utf-8') }));
  return [entry, ...dependencies];
}

function writeAssets(configDir: string, assets: PluginAssetFile[]): string[] {
  return assets.map((asset) => {
    const dest = join(configDir, asset.relativePath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, asset.content, 'utf-8');
    return dest;
  });
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

// Splits .opencode/package.json into exactly the two things the merge needs:
// the dependency pins and the required scalar fields. Used by the disk mode
// here and by scripts/generate-tui-plugin-assets.ts to bake the same two
// values into the binary.
export function extractRequiredPackageJsonFields(sourcePackageJson: Record<string, unknown>): { dependencies: Record<string, string>; scalars: Record<string, unknown> } {
  const sourceDeps = sourcePackageJson.dependencies;
  const dependencies = (sourceDeps && typeof sourceDeps === 'object' && !Array.isArray(sourceDeps) ? sourceDeps : {}) as Record<string, string>;
  const scalars: Record<string, unknown> = {};
  for (const field of PACKAGE_JSON_REQUIRED_SCALAR_FIELDS) {
    if (field in sourcePackageJson) scalars[field] = sourcePackageJson[field];
  }
  return { dependencies, scalars };
}

function mergePackageJson(configDir: string, requiredDeps: Record<string, string>, requiredScalars: Record<string, unknown>): { path: string; created: boolean } {
  const destPath = join(configDir, 'package.json');
  const created = !existsSync(destPath);
  const data: Record<string, unknown> = created ? {} : readJsonObject(destPath, 'package.json');

  // Ensure required scalar fields (private, type) are present without
  // overwriting anything already set, on both the create and the merge path.
  for (const [field, value] of Object.entries(requiredScalars)) {
    if (data[field] === undefined) data[field] = value;
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
// Two sources for the plugin files, one install pipeline:
//   - disk (default): the ocstatusline repo's own src/ and .opencode/
//     directories are present relative to this module (dev/source mode:
//     `bun run src/index.ts install`, or the Docker toolchain).
//   - embedded: options.embedded is supplied, which is what the compiled
//     standalone binary does -- it has no checkout to read from, so it hands
//     in the copy of the plugin source baked into it at build time (see
//     src/tui/embedded-plugin-assets.generated.ts). In that mode repoRoot is
//     never resolved and assertRepoRootLooksReal never runs.
//
// Every step here is safe to re-run: file writes overwrite in place, the
// package.json/tui.json writes are atomic (see writeJsonAtomic) and their
// merges are idempotent, and tui.json is only updated after npm install has
// actually succeeded, so a failed install never registers a plugin whose
// dependencies are not actually there.
export async function runTuiInstall(options: TuiInstallOptions = {}): Promise<TuiInstallResult> {
  const embedded = options.embedded;
  let repoRoot: string | null = null;
  let assets: PluginAssetFile[];
  let requiredDeps: Record<string, string>;
  let requiredScalars: Record<string, unknown>;

  if (embedded !== undefined) {
    assets = embedded.assets;
    requiredDeps = embedded.dependencies;
    requiredScalars = embedded.scalars;
  } else {
    repoRoot = resolveRepoRoot(options.repoRoot);
    assertRepoRootLooksReal(repoRoot);
    assets = collectPluginAssetsFromDisk(repoRoot);
    ({ dependencies: requiredDeps, scalars: requiredScalars } = extractRequiredPackageJsonFields(readJsonObject(join(repoRoot, PACKAGE_JSON_SRC_RELATIVE), '.opencode/package.json')));
  }

  const configDir = resolveConfigDir(options.configDir);
  mkdirSync(configDir, { recursive: true });

  const copiedFiles = writeAssets(configDir, assets);

  const { path: packageJsonPath, created: packageJsonCreated } = mergePackageJson(configDir, requiredDeps, requiredScalars);

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

  return { source: embedded !== undefined ? 'embedded' : 'disk', repoRoot, configDir, copiedFiles, tuiJsonPath, tuiJsonCreated, pluginAlreadyRegistered, packageJsonPath, packageJsonCreated, npmInstallRan };
}

// The install policy the CLI runs: prefer a real checkout, fall back to the
// binary's baked-in copy -- and *only* on the one error that means "there is
// no checkout here".
//
// Disk first, because from a checkout the files on disk are the fresher
// truth: someone editing the plugin gets what they just edited rather than
// whatever was baked in at build time. The compiled binary has no checkout,
// so its first attempt always fails with RepoCheckoutNotFoundError, and only
// that one is retried. A broader catch would turn any failure -- npm down,
// hand-mangled tui.json, an unreadable config dir -- into a second confusing
// attempt that hides the real cause; hence the narrow check, and the tests
// that pin exactly this control flow (a blanket `catch { retry }` refactor
// must fail the suite, not pass it).
export async function runTuiInstallWithEmbeddedFallback(embedded: EmbeddedPluginSource, options: TuiInstallOptions = {}): Promise<TuiInstallResult> {
  try {
    return await runTuiInstall(options);
  } catch (err) {
    if (!isRepoCheckoutNotFoundError(err)) throw err;
    return await runTuiInstall({ ...options, embedded });
  }
}
