#!/usr/bin/env bun
// probe-targets.ts — trial compile each candidate target, record what Bun accepts.

const candidates = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
];

console.log(`probing ${candidates.length} targets…`);
const accepted: string[] = [];

for (const target of candidates) {
  process.stdout.write(`  ${target} … `);
  try {
    const proc = Bun.spawnSync(["bun", "build", "--compile", "/src/src/index.ts", "--target", target, "--outfile", `/tmp/probe-${target}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      console.log("OK");
      accepted.push(target);
    } else {
      console.log("FAIL");
    }
  } catch {
    console.log("FAIL");
  }
}

console.log("");
console.log("accepted targets:");
for (const t of accepted) console.log(t);

if (accepted.length === 0) process.exit(1);