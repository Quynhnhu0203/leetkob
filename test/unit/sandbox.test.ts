import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildDockerRunArgs,
  compareTokenByToken,
  DEFAULT_SANDBOX_LIMITS,
  isDockerDaemonAvailable,
  isSandboxImageAvailable,
  judgeInSandbox,
  runProcessLimited,
} from "../../src/sandbox/runner.js";

const execFileAsync = promisify(execFile);

describe("Sandbox Configuration and 9 Requirements", () => {
  it("has default limits meeting brief §5 and FAQ-05 requirements", () => {
    expect(DEFAULT_SANDBOX_LIMITS.network).toBe("none");
    expect(DEFAULT_SANDBOX_LIMITS.cpuLimitSec).toBe(2);
    expect(DEFAULT_SANDBOX_LIMITS.wallClockTimeoutMs).toBe(6000);
    expect(DEFAULT_SANDBOX_LIMITS.memoryLimitBytes).toBe(256 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_LIMITS.memorySwapBytes).toBe(256 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_LIMITS.pidsLimit).toBe(16);
    expect(DEFAULT_SANDBOX_LIMITS.maxOutputBytes).toBe(1024 * 1024);
  });

  it("enforces all 9 security constraints in docker arguments", () => {
    const args = buildDockerRunArgs({
      command: ["./solution"],
      sourceDir: "/tmp/isolated",
      readOnlyWorkspace: true,
    });

    // 1. no network, interactive stdin, and init reaper
    expect(args).toContain("-i");
    expect(args).toContain("--init");
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");

    // 2. CPU time limit (--ulimit cpu)
    expect(args).toContain("--ulimit");
    expect(args[args.indexOf("--ulimit") + 1]).toBe("cpu=2:3");

    // 4. memory limit, swap included (256MB)
    expect(args).toContain("--memory");
    expect(args[args.indexOf("--memory") + 1]).toBe(`${256 * 1024 * 1024}b`);
    expect(args).toContain("--memory-swap");
    expect(args[args.indexOf("--memory-swap") + 1]).toBe(`${256 * 1024 * 1024}b`);

    // 5. process limit (16 per FAQ-05)
    expect(args).toContain("--pids-limit");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("16");

    // 7. non-root user (1000:1000) + read-only rootfs + dropped caps
    expect(args).toContain("--user");
    expect(args[args.indexOf("--user") + 1]).toBe("1000:1000");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");

    // 8. no host mounts and no Docker socket; workspace mounted :ro during execution
    const joined = args.join(" ");
    expect(joined).toContain("/tmp/isolated:/workspace:ro");
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

  it("creates nested TMPDIR directory if absent before staging sandbox files", async () => {
    const nestedTmp = path.join(os.tmpdir(), `leetkob-nested-${Date.now()}`, "sub");
    const prevTmpdir = process.env.TMPDIR;
    const prevTemp = process.env.TEMP;
    const prevTmp = process.env.TMP;
    process.env.TMPDIR = nestedTmp;
    process.env.TEMP = nestedTmp;
    process.env.TMP = nestedTmp;
    try {
      const res = await judgeInSandbox("invalid c++ code ???", []);
      expect(res.compileSuccess).toBe(false);
      expect(fs.existsSync(nestedTmp)).toBe(true);
    } finally {
      if (prevTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmpdir;
      if (prevTemp === undefined) delete process.env.TEMP;
      else process.env.TEMP = prevTemp;
      if (prevTmp === undefined) delete process.env.TMP;
      else process.env.TMP = prevTmp;
      await fs.promises.rm(path.dirname(nestedTmp), { recursive: true, force: true });
    }
  });
});

describe("The 9 Attack Submissions (source checks + live Docker execution when available)", () => {
  const attacksDir = path.resolve(__dirname, "../attacks");
  const sampleTest = [{ id: 1, input: "", expectedOutput: "OK" }];
  let dockerReady = false;

  beforeAll(async () => {
    const daemonAvailable = await isDockerDaemonAvailable();
    const imageBuilt = daemonAvailable && (await isSandboxImageAvailable());
    dockerReady = daemonAvailable && imageBuilt;
    if (process.env.REQUIRE_DOCKER === "1" && !dockerReady) {
      throw new Error(
        "REQUIRE_DOCKER=1 is set in CI, so Docker daemon and leetkob-sandbox:latest must both be available.",
      );
    }
  });

  it("attack files exist for all 9 minimums", () => {
    const expectedFiles = [
      "attack-1-network.cpp",
      "attack-2-cputime.cpp",
      "attack-3-walltime.cpp",
      "attack-4-memory.cpp",
      "attack-5-process-limit.cpp",
      "attack-6-output-limit.cpp",
      "attack-7-non-root.cpp",
      "attack-8-no-mounts.cpp",
      "attack-9-no-secrets.cpp",
    ];
    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(attacksDir, file))).toBe(true);
    }
  });

  it("baseline compliant C++ solution compiles inside container and passes (AC)", async () => {
    if (!dockerReady) return;
    const okCode = `#include <iostream>\nint main(){ int a,b; std::cin>>a>>b; std::cout<<(a+b)<<"\\n"; }`;
    const res = await judgeInSandbox(okCode, [{ id: 1, input: "2 3\n", expectedOutput: "5" }]);
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("AC");
  }, 25000);

  it("attack 1: no network — socket connect fails in sandbox", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-1-network.cpp"), "utf8");
    expect(code).toContain("8.8.8.8");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest);
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("RE");
    expect(res.testResults[0]?.output ?? "").not.toContain("BREACH");
  }, 25000);

  it("attack 2: CPU time limit kills infinite CPU loop via ulimit before wall clock", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-2-cputime.cpp"), "utf8");
    expect(code).toContain("while (true)");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest, {
      cpuLimitSec: 1,
      wallClockTimeoutMs: 8000,
    });
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("TLE");
    expect(res.testResults[0]?.timeMs ?? 9999).toBeLessThan(6500);
  }, 25000);

  it("attack 3: wall-clock limit kills sleeping container completely", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-3-walltime.cpp"), "utf8");
    expect(code).toContain("sleep_for");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest, {
      cpuLimitSec: 5,
      wallClockTimeoutMs: 1200,
    });
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("TLE");

    // Verify container itself was killed and removed
    if (res.lastContainerName) {
      const { stdout } = await execFileAsync("docker", [
        "ps",
        "-aq",
        "--filter",
        `name=${res.lastContainerName}`,
      ]);
      expect(stdout.trim()).toBe("");
    }
  }, 25000);

  it("attack 4: memory limit (swap included, read back) triggers cgroup OOM (MLE)", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-4-memory.cpp"), "utf8");
    expect(code).toContain("sum += mem[i]");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest, {
      memoryLimitBytes: 256 * 1024 * 1024,
      memorySwapBytes: 256 * 1024 * 1024,
    });
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("MLE");
  }, 25000);

  it("attack 5: process limit blocks fork bomb via --pids-limit", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-5-process-limit.cpp"), "utf8");
    expect(code).toContain("fork()");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest, {
      pidsLimit: 16,
      wallClockTimeoutMs: 5000,
    });
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("RE");
  }, 25000);

  it("attack 6: output limit stops stdout flood and cleans up container (OLE)", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-6-output-limit.cpp"), "utf8");
    expect(code).toContain("while (true)");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest, {
      maxOutputBytes: 65536,
      wallClockTimeoutMs: 5000,
    });
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("OLE");

    if (res.lastContainerName) {
      const { stdout } = await execFileAsync("docker", [
        "ps",
        "-aq",
        "--filter",
        `name=${res.lastContainerName}`,
      ]);
      expect(stdout.trim()).toBe("");
    }
  }, 25000);

  it("attack 7: non-root user (uid 1000) cannot write to /etc", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-7-non-root.cpp"), "utf8");
    expect(code).toContain("getuid()");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest);
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("RE");
    expect(res.testResults[0]?.output ?? "").not.toContain("BREACH");
  }, 25000);

  it("attack 8: no host mounts and no Docker socket", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-8-no-mounts.cpp"), "utf8");
    expect(code).toContain("/var/run/docker.sock");
    if (!dockerReady) return;

    const res = await judgeInSandbox(code, sampleTest);
    expect(res.compileSuccess).toBe(true);
    expect(res.verdict).toBe("RE");
    expect(res.testResults[0]?.output ?? "").not.toContain("BREACH");
  }, 25000);

  it("attack 9: no secrets in env, /proc/1/environ, or compile-time #include", async () => {
    const code = fs.readFileSync(path.join(attacksDir, "attack-9-no-secrets.cpp"), "utf8");
    expect(code).toContain("GEMINI_API_KEY");
    if (!dockerReady) return;

    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "AIza-fake-host-secret-must-never-leak";
    try {
      const res = await judgeInSandbox(code, sampleTest);
      expect(res.compileSuccess).toBe(true);
      expect(res.verdict).toBe("RE");
      expect(res.testResults[0]?.output ?? "").not.toContain("BREACH");

      // Compile-time #include attack cannot read host secrets either
      const includeAttack = `#include "/app/.env"\nint main() { return 0; }\n`;
      const compileRes = await judgeInSandbox(includeAttack, sampleTest);
      expect(compileRes.compileSuccess).toBe(false);
      expect(compileRes.verdict).toBe("CE");
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
    }
  }, 25000);
});
