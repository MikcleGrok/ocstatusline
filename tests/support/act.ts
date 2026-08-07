export type ProcessResult = { stdout: string; stderr: string; exitCode: number };

export async function runCli(args: string[], input = '', timeoutMs = 5000): Promise<ProcessResult> {
  if (typeof Bun === 'undefined') throw new Error('CLI process tests require Bun');
  const home = `/tmp/ocstatusline-cli-${crypto.randomUUID()}`;
  const child = Bun.spawn([process.execPath, 'run', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: `${home}/.config`, COLUMNS: '120' },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(input);
  child.stdin.end();
  const result = await Promise.race([
    child.exited.then(async (exitCode) => ({ exitCode, stdout: await new Response(child.stdout).text(), stderr: await new Response(child.stderr).text() })),
    new Promise<never>((_, reject) => setTimeout(() => { child.kill(); reject(new Error(`CLI timed out after ${timeoutMs}ms`)); }, timeoutMs)),
  ]);
  return result;
}
