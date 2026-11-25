import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export interface SandboxLimits {
  network: "none";
  cpuLimitSec: number;
  wallClockTimeoutMs: number;
  memoryLimitBytes: number;
  memorySwapBytes: number;
  pidsLimit: number;
  maxOutputBytes: number;
  user: string;
  dropCapabilities: string[];
}

// Defaults align with brief §5 minimums and LeeTKOB FAQ-05
export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  network: "none",
  cpuLimitSec: 2,
  wallClockTimeoutMs: 6000, // 3x CPU time per FAQ-05
  memoryLimitBytes: 256 * 1024 * 1024, // 256 MiB
  memorySwapBytes: 256 * 1024 * 1024, // swap included (no extra swap)
  pidsLimit: 16, // FAQ-05: 16 processes including threads
  maxOutputBytes: 1024 * 1024, // FAQ-05: 1 MiB max output per test
  user: "1000:1000",
  dropCapabilities: ["ALL"],
};

export interface BuildDockerArgsOptions {
  containerName?: string | undefined;
  limits?: Partial<SandboxLimits> | undefined;
  sourceDir?: string | undefined;
  readOnlyWorkspace?: boolean | undefined;
  autoRemove?: boolean | undefined;
  command: string[];
}

/**
 * Checks whether the Docker daemon is reachable on the host.
 */
export async function isDockerDaemonAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a Docker container cleanly if it exists (ignoring errors if already removed).
 */
export async function removeContainer(containerName: string): Promise<void> {
  try {
    await execFileAsync("docker", ["rm", "-f", containerName], { timeout: 5000 });
  } catch {
    // Container may already be removed or never started
  }
}

/**
 * Inspects whether a stopped Docker container was terminated by cgroup OOM killer.
 */
async function inspectContainerOomKilled(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "-f", "{{.State.OOMKilled}}", containerName],
      { timeout: 3000 },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Builds the hardened argument list for `docker run` enforcing all 9 sandbox minimums.
 */
export function buildDockerRunArgs(options: BuildDockerArgsOptions): string[] {
  const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits };
  const cpuHard = limits.cpuLimitSec + 1;
  const args: string[] = ["run", "--init"];

  if (options.autoRemove !== false) {
    args.push("--rm");
  }

  args.push(
    "--network",
    limits.network,
    "--ulimit",
    `cpu=${limits.cpuLimitSec}:${cpuHard}`,
    "--memory",
    `${limits.memoryLimitBytes}b`,
    "--memory-swap",
    `${limits.memorySwapBytes}b`,
    "--pids-limit",
    `${limits.pidsLimit}`,
    "--user",
    limits.user,
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
  );

  if (options.containerName) {
    args.push("--name", options.containerName);
  }

  // Ephemeral isolated workspace only; never host paths or Docker socket
  if (options.sourceDir) {
    const mode = options.readOnlyWorkspace ? "ro" : "rw";
    args.push("-v", `${options.sourceDir}:/workspace:${mode}`);
    args.push("-w", "/workspace");
  }

  // Minimal clean environment: zero secrets or API keys
  args.push("-e", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");

  // Image and command
  args.push("leetkob-sandbox:latest", ...options.command);
  return args;
}

export interface TestCase {
  id: number;
  input: string;
  expectedOutput: string;
}

export type JudgeVerdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "OLE" | "CE";

export interface JudgeResult {
  verdict: JudgeVerdict;
  compileSuccess: boolean;
  compileOutput: string;
  lastContainerName?: string | undefined;
  testResults: {
    testId: number;
    verdict: JudgeVerdict;
    timeMs: number;
    output?: string | undefined;
  }[];
}

/**
 * Compares two output strings token by token, ignoring whitespace differences.
 */
export function compareTokenByToken(actual: string, expected: string): boolean {
  const actualTokens = actual.trim().split(/\s+/).filter(Boolean);
  const expectedTokens = expected.trim().split(/\s+/).filter(Boolean);
  if (actualTokens.length !== expectedTokens.length) return false;
  for (let i = 0; i < actualTokens.length; i++) {
    if (actualTokens[i] !== expectedTokens[i]) return false;
  }
  return true;
}

/**
 * Executes a process with wall clock timeout and max output limit.
 */
export async function runProcessLimited(
  cmd: string,
  args: string[],
  options: {
    input?: string | undefined;
    cwd?: string | undefined;
    timeoutMs: number;
    maxOutputBytes: number;
  },
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;

    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, options.timeoutMs);

    const handleChunk = (chunk: Buffer, target: "stdout" | "stderr"): void => {
      if (outputLimitExceeded) return;
      if (stdout.length + stderr.length + chunk.length > options.maxOutputBytes) {
        outputLimitExceeded = true;
        proc.kill("SIGKILL");
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => handleChunk(chunk, "stdout"));
    proc.stderr.on("data", (chunk: Buffer) => handleChunk(chunk, "stderr"));

    proc.stdin.on("error", () => {
      // Ignore EPIPE if child process exits before consuming stdin
    });

    if (options.input !== undefined) {
      proc.stdin.write(options.input);
    }
    proc.stdin.end();

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, errMsg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr: errMsg && !stderr ? errMsg : stderr,
        timedOut,
        outputLimitExceeded,
      });
    };

    proc.on("close", (exitCode, signal) => finish(exitCode, signal));
    proc.on("error", (err) => finish(-1, null, err.message));
  });
}

/**
 * Compiles and executes C++ code in the hardened Docker sandbox against testcases.
 */
export async function judgeInSandbox(
  sourceCode: string,
  tests: TestCase[],
  limits: Partial<SandboxLimits> = {},
): Promise<JudgeResult> {
  const mergedLimits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...limits };
  await fs.mkdir(os.tmpdir(), { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leetkob-judge-"));

  try {
    const srcFile = path.join(tempDir, "solution.cpp");
    const binFile = path.join(tempDir, "solution");
    await fs.writeFile(srcFile, sourceCode, "utf8");

    if (process.platform !== "win32") {
      // Allow UID 1000 inside container to write compiled binary regardless of host runner UID
      await fs.chmod(tempDir, 0o777);
      await fs.chmod(srcFile, 0o644);
    }

    const hasDocker = await isDockerDaemonAvailable();
    if (process.env.REQUIRE_DOCKER === "1" && !hasDocker) {
      throw new Error("REQUIRE_DOCKER=1 is set, but the Docker daemon is not reachable.");
    }

    let compileOutput = "";
    let compileSuccess = false;

    if (hasDocker) {
      const compileContainerName = `judge-compile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const compileCpuSec = Math.max(mergedLimits.cpuLimitSec, 10);
      const dockerCompileArgs = buildDockerRunArgs({
        containerName: compileContainerName,
        limits: {
          ...mergedLimits,
          cpuLimitSec: compileCpuSec,
          pidsLimit: Math.max(mergedLimits.pidsLimit, 32),
        },
        sourceDir: tempDir,
        readOnlyWorkspace: false,
        autoRemove: true,
        command: ["g++", "-std=c++17", "-O2", "-o", "solution", "solution.cpp"],
      });

      try {
        const res = await runProcessLimited("docker", dockerCompileArgs, {
          timeoutMs: 15000,
          maxOutputBytes: mergedLimits.maxOutputBytes,
        });
        compileSuccess = !res.timedOut && !res.outputLimitExceeded && res.exitCode === 0;
        compileOutput = res.timedOut ? "Compilation timed out." : res.stderr || res.stdout;
      } finally {
        await removeContainer(compileContainerName);
      }
    } else {
      try {
        const res = await runProcessLimited("g++", ["-std=c++17", "-O2", "-o", binFile, srcFile], {
          timeoutMs: 15000,
          maxOutputBytes: mergedLimits.maxOutputBytes,
        });
        compileSuccess = !res.timedOut && !res.outputLimitExceeded && res.exitCode === 0;
        compileOutput = res.stderr || res.stdout;
      } catch (e) {
        compileSuccess = false;
        compileOutput = (e as Error).message;
      }
    }

    if (!compileSuccess) {
      return {
        verdict: "CE",
        compileSuccess: false,
        compileOutput,
        testResults: [],
      };
    }

    // Lock workspace dir mode (owned by host UID) before read-only execution; g++ binary already has 0755
    if (process.platform !== "win32") {
      await fs.chmod(tempDir, 0o755);
    }

    const testResults: JudgeResult["testResults"] = [];
    let overallVerdict: JudgeVerdict = "AC";
    let lastContainerName: string | undefined;

    for (const t of tests) {
      const startTime = Date.now();
      let testVerdict: JudgeVerdict = "AC";
      let actualOutput = "";

      if (hasDocker) {
        const containerName = `judge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        lastContainerName = containerName;
        // Disable autoRemove so we can inspect State.OOMKilled reliably, then always rm -f in finally
        const dockerRunArgs = buildDockerRunArgs({
          containerName,
          limits: mergedLimits,
          sourceDir: tempDir,
          readOnlyWorkspace: true,
          autoRemove: false,
          command: ["./solution"],
        });

        try {
          const runRes = await runProcessLimited("docker", dockerRunArgs, {
            input: t.input,
            timeoutMs: mergedLimits.wallClockTimeoutMs,
            maxOutputBytes: mergedLimits.maxOutputBytes,
          });

          const elapsed = Date.now() - startTime;
          actualOutput = runRes.stdout;

          if (runRes.outputLimitExceeded) {
            testVerdict = "OLE";
          } else if (runRes.timedOut || runRes.exitCode === 152) {
            // exitCode 152 = 128 + SIGXCPU (24)
            testVerdict = "TLE";
          } else if (runRes.exitCode === 137) {
            const oomKilled = await inspectContainerOomKilled(containerName);
            if (oomKilled) {
              testVerdict = "MLE";
            } else if (elapsed >= mergedLimits.cpuLimitSec * 1000 * 0.85) {
              testVerdict = "TLE";
            } else {
              testVerdict = "RE";
            }
          } else if (runRes.exitCode !== 0) {
            testVerdict = "RE";
          } else if (!compareTokenByToken(actualOutput, t.expectedOutput)) {
            testVerdict = "WA";
          }

          testResults.push({
            testId: t.id,
            verdict: testVerdict,
            timeMs: elapsed,
            output: actualOutput,
          });
        } finally {
          await removeContainer(containerName);
        }
      } else {
        const runRes = await runProcessLimited(binFile, [], {
          input: t.input,
          timeoutMs: mergedLimits.wallClockTimeoutMs,
          maxOutputBytes: mergedLimits.maxOutputBytes,
        });
        const elapsed = Date.now() - startTime;
        actualOutput = runRes.stdout;

        if (runRes.outputLimitExceeded) {
          testVerdict = "OLE";
        } else if (runRes.timedOut) {
          testVerdict = "TLE";
        } else if (runRes.exitCode !== 0) {
          testVerdict = "RE";
        } else if (!compareTokenByToken(actualOutput, t.expectedOutput)) {
          testVerdict = "WA";
        }

        testResults.push({
          testId: t.id,
          verdict: testVerdict,
          timeMs: elapsed,
          output: actualOutput,
        });
      }

      if (testVerdict !== "AC" && overallVerdict === "AC") {
        overallVerdict = testVerdict;
      }
    }

    return {
      verdict: overallVerdict,
      compileSuccess: true,
      compileOutput,
      lastContainerName,
      testResults,
    };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp dir cleanup failure
    }
  }
}
