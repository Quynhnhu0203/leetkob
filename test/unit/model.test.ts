import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripCodeForModel } from "../../src/model/stripper.js";
import { buildModelPrompt } from "../../src/model/prompt.js";
import { OfflineFakeModelClient } from "../../src/model/client.js";
import { runChecker } from "../../src/checker-cli.js";

describe("Model Stripper — Identity and Comment Sanitization", () => {
  it("strips comments while preserving line count", () => {
    const raw = `
// Author: Nguyen Van A - 23120068
#include <iostream>
/* Block comment explaining
   the merge sort implementation */
int main() {
    // print hello
    return 0;
}
`;
    const stripped = stripCodeForModel(raw);
    expect(stripped).not.toContain("Author");
    expect(stripped).not.toContain("Nguyen Van A");
    expect(stripped).not.toContain("23120068");
    expect(stripped).not.toContain("Block comment");
    expect(stripped).not.toContain("print hello");
    expect(stripped).toContain("int main()");

    // Verify line count is preserved exactly
    expect(stripped.split("\n").length).toBe(raw.split("\n").length);
  });
});

describe("Model Prompt Generation", () => {
  it("sends only statement, constraints, and stripped code — no student identity", () => {
    const prompt = buildModelPrompt({
      statement: "Implement merge sort on an array of integers.",
      constraint: {
        id: "C2",
        text: "Sort with a merge sort you wrote yourself: split the range, sort both halves, merge them.",
      },
      code: `// Student 23120099
void mergeSort() {}
int main() {}`,
    });

    expect(prompt).toContain("Implement merge sort on an array of integers.");
    expect(prompt).toContain("Sort with a merge sort you wrote yourself");
    expect(prompt).toContain("void mergeSort()");
    expect(prompt).not.toContain("23120099");
    expect(prompt).not.toContain("Student 23120099");

    // Must never leak dev-set filenames or specific problem tuning
    expect(prompt).not.toContain("sort-merge/s05");
    expect(prompt).not.toContain("labels.jsonl");

    // Checks schema instructions
    expect(prompt).toContain('"verdict": "pass" | "violation" | "unsure"');
    expect(prompt).toContain('"evidence"');
  });
});

describe("Model Call Log and Cost Arithmetic", () => {
  it("logs model calls with provider request id, tokens, and cost", async () => {
    const fakeClient = new OfflineFakeModelClient({
      "C2:void mergeSort() {}": {
        verdict: "pass",
        evidence: [],
      },
    });

    const res = await fakeClient.call({
      statement: "Sort array",
      constraint: { id: "C2", text: "Sort with own merge sort" },
      code: "void mergeSort() {}",
    });

    expect(res.verdict).toBe("pass");
    const log = fakeClient.getCallLog();
    expect(log.length).toBe(1);
    expect(log[0]?.requestId).toMatch(/^fake-req-/);
    expect(log[0]?.model).toBe("offline-fake-model");
    expect(log[0]?.promptTokens).toBeGreaterThan(0);
    expect(log[0]?.totalTokens).toBeGreaterThan(0);
    expect(log[0]?.parsedOutput?.verdict).toBe("pass");
  });
});

describe("Checker CLI — MODEL_OFF=1 & standalone dataset execution", () => {
  it("writes valid JSONL using hard rules only and 0 model calls when MODEL_OFF=1", async () => {
    const tmpOut = path.join(os.tmpdir(), `leetkob-pred-${Date.now()}.jsonl`);
    const fakeClient = new OfflineFakeModelClient();
    const callSpy = vi.spyOn(fakeClient, "call");

    const prevOff = process.env.MODEL_OFF;
    process.env.MODEL_OFF = "1";
    try {
      const preds = await runChecker({
        dataDir: path.resolve(__dirname, "../../eval"),
        outputFile: tmpOut,
        modelClient: fakeClient,
      });

      // Zero model calls when MODEL_OFF=1
      expect(callSpy).not.toHaveBeenCalled();
      expect(preds.length).toBe(102);

      // Ban-list C1 in sort-merge/s04 catches violation cleanly
      const s04c1 = preds.find((p) => p.solution === "sort-merge/s04" && p.constraint === "C1");
      expect(s04c1?.verdict).toBe("violation");
      expect(s04c1?.evidence.length).toBeGreaterThan(0);

      // Semantic C2 in sort-merge/s01 outputs unsure
      const s01c2 = preds.find((p) => p.solution === "sort-merge/s01" && p.constraint === "C2");
      expect(s01c2?.verdict).toBe("unsure");

      const written = await fs.readFile(tmpOut, "utf8");
      expect(written.trim().split("\n").length).toBe(102);
    } finally {
      if (prevOff === undefined) delete process.env.MODEL_OFF;
      else process.env.MODEL_OFF = prevOff;
      await fs.rm(tmpOut, { force: true });
    }
  });
});
