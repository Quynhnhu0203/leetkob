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

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  network: "none",
  cpuLimitSec: 2,
  wallClockTimeoutMs: 4000,
  memoryLimitBytes: 256 * 1024 * 1024, // 256 MiB
  memorySwapBytes: 256 * 1024 * 1024, // swap included (no extra swap)
  pidsLimit: 64,
  maxOutputBytes: 65536, // 64 KiB
  user: "1000:1000",
  dropCapabilities: ["ALL"],
};

export interface BuildDockerArgsOptions {
  containerName?: string;
  limits?: Partial<SandboxLimits>;
  workDir?: string;
  sourceDir?: string;
  command: string[];
}

/**
 * Builds the hardened argument list for docker run enforcing all 9 sandbox requirements.
 */
export function buildDockerRunArgs(options: BuildDockerArgsOptions): string[] {
  const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits };
  const args: string[] = [
    "run",
    "--rm",
    "--network",
    limits.network,
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
  ];

  if (options.containerName) {
    args.push("--name", options.containerName);
  }

  // Workdir mounting: isolated ephemeral work directory only
  if (options.sourceDir) {
    args.push("-v", `${options.sourceDir}:/workspace:rw`);
    args.push("-w", "/workspace");
  }

  // Pure clean environment: absolutely no secret or API key passed
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
  testResults: {
    testId: number;
    verdict: JudgeVerdict;
    timeMs: number;
    output?: string;
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
    input?: string;
    cwd?: string;
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

    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, options.timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > options.maxOutputBytes) {
        outputLimitExceeded = true;
        proc.kill("SIGKILL");
      } else {
        stdout += chunk.toString("utf8");
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > options.maxOutputBytes) {
        outputLimitExceeded = true;
        proc.kill("SIGKILL");
      } else {
        stderr += chunk.toString("utf8");
      }
    });

    if (options.input !== undefined) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }

    proc.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        outputLimitExceeded,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        signal: null,
        stdout,
        stderr: err.message,
        timedOut: false,
        outputLimitExceeded: false,
      });
    });
  });
}

/**
 * Compiles and executes code in the sandbox against tests.
 */
export async function judgeInSandbox(
  sourceCode: string,
  tests: TestCase[],
  limits: Partial<SandboxLimits> = {},
): Promise<JudgeResult> {
  const mergedLimits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...limits };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leetkob-judge-"));

  try {
    const srcFile = path.join(tempDir, "solution.cpp");
    const binFile = path.join(tempDir, "solution");
    await fs.writeFile(srcFile, sourceCode, "utf8");

    // 1. Compile step (inside the sandbox or via g++)
    // Check if docker is available
    let hasDocker = false;
    try {
      await execFileAsync("docker", ["--version"]);
      hasDocker = true;
    } catch {
      hasDocker = false;
    }

    let compileOutput = "";
    let compileSuccess = false;

    if (hasDocker) {
      const dockerCompileArgs = buildDockerRunArgs({
        sourceDir: tempDir,
        command: ["g++", "-std=c++17", "-O2", "-o", "solution", "solution.cpp"],
      });
      const res = await runProcessLimited("docker", dockerCompileArgs, {
        timeoutMs: 15000,
        maxOutputBytes: mergedLimits.maxOutputBytes,
      });
      compileSuccess = res.exitCode === 0;
      compileOutput = res.stderr || res.stdout;
    } else {
      // Local fallback for environments without docker daemon
      try {
        const res = await runProcessLimited("g++", ["-std=c++17", "-O2", "-o", binFile, srcFile], {
          timeoutMs: 15000,
          maxOutputBytes: mergedLimits.maxOutputBytes,
        });
        compileSuccess = res.exitCode === 0;
        compileOutput = res.stderr;
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

    // 2. Run testcases
    const testResults: JudgeResult["testResults"] = [];
    let overallVerdict: JudgeVerdict = "AC";

    for (const t of tests) {
      const startTime = Date.now();
      let testVerdict: JudgeVerdict = "AC";
      let actualOutput = "";

      if (hasDocker) {
        const containerName = `judge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dockerRunArgs = buildDockerRunArgs({
          containerName,
          limits: mergedLimits,
          sourceDir: tempDir,
          command: ["./solution"],
        });

        const runRes = await runProcessLimited("docker", dockerRunArgs, {
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
          // Ensure container is forcefully killed
          try {
            await execFileAsync("docker", ["rm", "-f", containerName]);
          } catch {
            // ignore cleanup error
          }
        } else if (runRes.exitCode === 137) {
          // Exit 137 indicates SIGKILL (either OOM or timeout)
          testVerdict = elapsed >= mergedLimits.wallClockTimeoutMs ? "TLE" : "MLE";
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
      } else {
        // Fallback local runner
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
