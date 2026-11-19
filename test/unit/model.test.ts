import { describe, it, expect } from "vitest";
import { stripCodeForModel } from "../../src/model/stripper.js";
import { buildModelPrompt } from "../../src/model/prompt.js";
import { OfflineFakeModelClient } from "../../src/model/client.js";

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
