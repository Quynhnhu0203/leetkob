import fs from "node:fs/promises";
import path from "node:path";
import { checkHardRule } from "./reviewer/hard-rules.js";
import { GeminiModelClient, OfflineFakeModelClient, type ModelClient } from "./model/client.js";
import { validateAndVerifyModelOutput } from "./reviewer/limits.js";
import type { Constraint } from "./store.js";

export interface PredictionLine {
  solution: string;
  constraint: string;
  verdict: "pass" | "violation" | "unsure";
  evidence: Array<{ line: number; text: string }>;
}

export async function runChecker(options: {
  dataDir: string;
  outputFile: string;
  modelClient?: ModelClient;
  modelOff?: boolean;
}): Promise<PredictionLine[]> {
  const modelOff =
    options.modelOff ?? (process.env.MODEL_OFF === "1" || !process.env.GEMINI_API_KEY);
  const client =
    options.modelClient ??
    (modelOff
      ? new OfflineFakeModelClient()
      : new GeminiModelClient({
          logFilePath: path.resolve(process.cwd(), "call-log.jsonl"),
        }));

  const problemsDir = path.join(options.dataDir, "problems");
  const solutionsDir = path.join(options.dataDir, "solutions");

  const problemNames = await fs.readdir(problemsDir);
  const predictions: PredictionLine[] = [];

  for (const prob of problemNames.sort()) {
    const probDir = path.join(problemsDir, prob);
    const probStat = await fs.stat(probDir);
    if (!probStat.isDirectory()) continue;

    const stmtPath = path.join(probDir, "statement.md");
    const constrPath = path.join(probDir, "constraints.json");

    let statement = "";
    try {
      statement = await fs.readFile(stmtPath, "utf8");
    } catch {
      // statement optional or empty
    }

    const constrContent = await fs.readFile(constrPath, "utf8");
    const constraints = JSON.parse(constrContent) as Constraint[];

    const solProbDir = path.join(solutionsDir, prob);
    let solFiles: string[] = [];
    try {
      solFiles = (await fs.readdir(solProbDir)).filter((f) => f.endsWith(".cpp")).sort();
    } catch {
      continue;
    }

    for (const solFile of solFiles) {
      const solId = solFile.replace(/\.cpp$/, "");
      const solutionKey = `${prob}/${solId}`;
      const code = await fs.readFile(path.join(solProbDir, solFile), "utf8");

      for (const c of constraints) {
        // 1. Hard rules first for ban-list
        const hardRes = checkHardRule(code, c.text);
        if (hardRes.isBanList && hardRes.verdict) {
          predictions.push({
            solution: solutionKey,
            constraint: c.id,
            verdict: hardRes.verdict,
            evidence: hardRes.evidence ?? [],
          });
          continue;
        }

        // 2. Semantic constraint
        if (modelOff) {
          predictions.push({
            solution: solutionKey,
            constraint: c.id,
            verdict: "unsure",
            evidence: [],
          });
          continue;
        }

        try {
          const raw = await client.call({
            statement,
            constraint: { id: c.id, text: c.text },
            code,
          });
          const validated = validateAndVerifyModelOutput(raw, code);
          predictions.push({
            solution: solutionKey,
            constraint: c.id,
            verdict: validated.verdict,
            evidence: validated.evidence,
          });
        } catch {
          predictions.push({
            solution: solutionKey,
            constraint: c.id,
            verdict: "unsure",
            evidence: [],
          });
        }
      }
    }
  }

  // Write predictions to JSONL file
  await fs.mkdir(path.dirname(path.resolve(options.outputFile)), { recursive: true });
  const content = predictions.map((p) => JSON.stringify(p)).join("\n") + "\n";
  await fs.writeFile(options.outputFile, content, "utf8");

  return predictions;
}

// CLI runner when invoked directly
async function main() {
  const args = process.argv.slice(2);
  let dataDir = ".";
  let outputFile = "predictions.jsonl";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data" && args[i + 1]) {
      dataDir = args[++i]!;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[++i]!;
    }
  }

  await runChecker({ dataDir, outputFile });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  void main();
}
