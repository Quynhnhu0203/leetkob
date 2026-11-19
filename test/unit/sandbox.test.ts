import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildDockerRunArgs,
  compareTokenByToken,
  DEFAULT_SANDBOX_LIMITS,
  runProcessLimited,
} from "../../src/sandbox/runner.js";

describe("Sandbox Configuration and 9 Requirements", () => {
  it("has default limits meeting brief requirements", () => {
    expect(DEFAULT_SANDBOX_LIMITS.network).toBe("none");
    expect(DEFAULT_SANDBOX_LIMITS.cpuLimitSec).toBe(2);
    expect(DEFAULT_SANDBOX_LIMITS.memoryLimitBytes).toBe(256 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_LIMITS.pidsLimit).toBe(64);
  });
  it("enforces all 9 security constraints in docker arguments", () => {
    const args = buildDockerRunArgs({
      command: ["./solution"],
      sourceDir: "/tmp/isolated",
    });

    // 1. no network
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");

    // 4. memory limit, swap included (256MB)
    expect(args).toContain("--memory");
    expect(args[args.indexOf("--memory") + 1]).toBe(`${256 * 1024 * 1024}b`);
    expect(args).toContain("--memory-swap");
    expect(args[args.indexOf("--memory-swap") + 1]).toBe(`${256 * 1024 * 1024}b`);

    // 5. process limit (64)
    expect(args).toContain("--pids-limit");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("64");

    // 7. non-root user (1000:1000)
    expect(args).toContain("--user");
    expect(args[args.indexOf("--user") + 1]).toBe("1000:1000");

    // 8. no host mounts and no Docker socket
    const joined = args.join(" ");
    expect(joined).not.toContain("/var/run/docker.sock");
    expect(joined).not.toContain("/run/docker.sock");
    expect(joined).not.toContain("--privileged");

    // 9. no secrets in environment
    expect(joined).not.toContain("GEMINI_API_KEY");
    expect(joined).not.toContain("MODEL_API_KEY");
    expect(joined).not.toContain("API_KEY");
  });

  it("compares outputs token by token, ignoring whitespace", () => {
    expect(compareTokenByToken("1 2  3\n4\n", "1   2 3 4")).toBe(true);
    expect(compareTokenByToken("1 2 3", "1 2 4")).toBe(false);
    expect(compareTokenByToken("1 2", "1 2 3")).toBe(false);
  });

  it("enforces output size truncation in runProcessLimited", async () => {
    const res = await runProcessLimited(
      process.execPath,
      ["-e", "while(true) process.stdout.write('x'.repeat(1000))"],
      {
        timeoutMs: 2000,
        maxOutputBytes: 1024,
      },
    );
    expect(res.outputLimitExceeded).toBe(true);
    expect(res.stdout.length).toBeLessThanOrEqual(2048);
  });

  it("enforces wall-clock execution timeout in runProcessLimited", async () => {
    const res = await runProcessLimited(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });
    expect(res.timedOut).toBe(true);
  });
});

describe("The 9 Attack Submissions exist and implement threat scenarios", () => {
  const attacksDir = path.resolve(__dirname, "../attacks");

  it("attack 1: no network (attempts socket connection to 8.8.8.8:80)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-1-network.cpp"), "utf8");
    expect(code).toContain("socket");
    expect(code).toContain("connect");
    expect(code).toContain("8.8.8.8");
  });

  it("attack 2: CPU time limit (infinite CPU calculation loop)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-2-cputime.cpp"), "utf8");
    expect(code).toContain("while (true)");
  });

  it("attack 3: wall-clock limit (sleeps for 120 seconds)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-3-walltime.cpp"), "utf8");
    expect(code).toContain("sleep");
  });

  it("attack 4: memory limit (allocates 512MB and reads back so allocation cannot be optimized)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-4-memory.cpp"), "utf8");
    expect(code).toContain("512 * 1024 * 1024");
    expect(code).toContain("sum += mem[i]");
  });

  it("attack 5: process limit (fork bomb)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-5-process-limit.cpp"), "utf8");
    expect(code).toContain("fork()");
  });

  it("attack 6: output limit (infinite stdout flood)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-6-output-limit.cpp"), "utf8");
    expect(code).toContain("while (true)");
    expect(code).toContain("cout");
  });

  it("attack 7: non-root user (attempts getuid() == 0 and write to /etc)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-7-non-root.cpp"), "utf8");
    expect(code).toContain("getuid()");
    expect(code).toContain("/etc/hacked.txt");
  });

  it("attack 8: no host mounts and no Docker socket (checks /var/run/docker.sock)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-8-no-mounts.cpp"), "utf8");
    expect(code).toContain("/var/run/docker.sock");
  });

  it("attack 9: no secrets (scans env and /proc/1/environ for API keys)", () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-9-no-secrets.cpp"), "utf8");
    expect(code).toContain("GEMINI_API_KEY");
    expect(code).toContain("/proc/1/environ");
  });
});
