import fs from "node:fs/promises";
import path from "node:path";
import { buildModelPrompt, type ConstraintPromptParams } from "./prompt.js";

export interface EvidenceLine {
  line: number;
  text: string;
}

export interface ModelOutput {
  verdict: "pass" | "violation" | "unsure";
  evidence: EvidenceLine[];
}

export interface CallMetadata {
  solution?: string | undefined;
  constraint?: string | undefined;
}

export interface CallLogEntry {
  timestamp: string;
  requestId: string;
  model: string;
  solution?: string | undefined;
  constraint?: string | undefined;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd: number;
  prompt: string;
  rawResponse: string;
  parsedOutput?: ModelOutput | undefined;
}

export interface ModelClient {
  call(params: ConstraintPromptParams, meta?: CallMetadata): Promise<ModelOutput>;
  getCallLog(): CallLogEntry[];
}

export class OfflineFakeModelClient implements ModelClient {
  private readonly responses: Map<string, ModelOutput>;
  private readonly defaultResponse: ModelOutput;
  private readonly callLog: CallLogEntry[] = [];
  public delayMs = 0;
  public failWithTimeout = false;

  constructor(
    responses: Record<string, ModelOutput> = {},
    defaultResponse: ModelOutput = { verdict: "unsure", evidence: [] },
  ) {
    this.responses = new Map(Object.entries(responses));
    this.defaultResponse = defaultResponse;
  }

  async call(params: ConstraintPromptParams, meta?: CallMetadata): Promise<ModelOutput> {
    const prompt = buildModelPrompt(params);
    const start = Date.now();

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    if (this.failWithTimeout) {
      throw new Error("Request timed out");
    }

    const key = `${params.constraint.id}:${params.code.slice(0, 30)}`;
    const output = this.responses.get(key) ?? this.defaultResponse;
    const durationMs = Date.now() - start;

    const entry: CallLogEntry = {
      timestamp: new Date().toISOString(),
      requestId: `fake-req-${Math.random().toString(36).slice(2, 10)}`,
      model: "offline-fake-model",
      solution: meta?.solution,
      constraint: meta?.constraint ?? params.constraint.id,
      promptTokens: Math.ceil(prompt.length / 4),
      candidatesTokens: 25,
      totalTokens: Math.ceil(prompt.length / 4) + 25,
      durationMs,
      costUsd: 0,
      prompt,
      rawResponse: JSON.stringify(output),
      parsedOutput: output,
    };
    this.callLog.push(entry);

    return output;
  }

  getCallLog(): CallLogEntry[] {
    return [...this.callLog];
  }
}

export interface GeminiClientOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  logFilePath?: string | undefined;
  timeoutMs?: number | undefined;
}

export class GeminiModelClient implements ModelClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly logFilePath?: string | undefined;
  private readonly timeoutMs: number;
  private readonly callLog: CallLogEntry[] = [];

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
    this.logFilePath = options.logFilePath;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  private async appendCallLog(entry: CallLogEntry): Promise<void> {
    this.callLog.push(entry);
    if (this.logFilePath) {
      await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
      await fs.appendFile(this.logFilePath, JSON.stringify(entry) + "\n", "utf8");
    }
  }

  async call(params: ConstraintPromptParams, meta?: CallMetadata): Promise<ModelOutput> {
    const prompt = buildModelPrompt(params);
    const start = Date.now();

    if (!this.apiKey) {
      return { verdict: "unsure", evidence: [] };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let rawResponse = "";
    let requestId = "";
    let promptTokens = 0;
    let candidatesTokens = 0;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const headerReqId = res.headers.get("x-goog-request-id") ?? res.headers.get("x-request-id");
      const rawBodyText = await res.text();

      let data: {
        responseId?: string;
        modelVersion?: string;
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      } = {};
      try {
        data = JSON.parse(rawBodyText) as typeof data;
      } catch {
        rawResponse = rawBodyText;
      }

      requestId = headerReqId || data.responseId || `http-${res.status}-${Date.now()}`;

      if (!res.ok) {
        const durationMs = Date.now() - start;
        const output: ModelOutput = { verdict: "unsure", evidence: [] };
        await this.appendCallLog({
          timestamp: new Date().toISOString(),
          requestId,
          model: data.modelVersion ?? this.model,
          solution: meta?.solution,
          constraint: meta?.constraint ?? params.constraint.id,
          promptTokens: Math.ceil(prompt.length / 4),
          candidatesTokens: 0,
          totalTokens: Math.ceil(prompt.length / 4),
          durationMs,
          costUsd: 0,
          prompt,
          rawResponse: `HTTP ${res.status}: ${rawBodyText.slice(0, 500)}`,
          parsedOutput: output,
        });
        return output;
      }

      rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ?? rawBodyText;
      promptTokens = data.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
      candidatesTokens =
        data.usageMetadata?.candidatesTokenCount ?? Math.ceil(rawResponse.length / 4);

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        parsed = null;
      }

      // Strict schema validation without silent array coercion
      let output: ModelOutput = { verdict: "unsure", evidence: [] };
      const isEvidenceList = (arr: unknown[]): arr is EvidenceLine[] =>
        arr.every(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item) &&
            typeof (item as { line?: unknown }).line === "number" &&
            Number.isInteger((item as { line: number }).line) &&
            typeof (item as { text?: unknown }).text === "string",
        );

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        "verdict" in parsed &&
        typeof parsed.verdict === "string" &&
        ["pass", "violation", "unsure"].includes(parsed.verdict) &&
        "evidence" in parsed &&
        Array.isArray(parsed.evidence) &&
        isEvidenceList(parsed.evidence)
      ) {
        output = {
          verdict: parsed.verdict as "pass" | "violation" | "unsure",
          evidence: parsed.evidence,
        };
      }

      const durationMs = Date.now() - start;
      // Cost arithmetic: $0.075 / 1M input tokens, $0.30 / 1M output tokens
      const costUsd = (promptTokens * 0.075) / 1_000_000 + (candidatesTokens * 0.3) / 1_000_000;

      await this.appendCallLog({
        timestamp: new Date().toISOString(),
        requestId,
        model: data.modelVersion ?? this.model,
        solution: meta?.solution,
        constraint: meta?.constraint ?? params.constraint.id,
        promptTokens,
        candidatesTokens,
        totalTokens: promptTokens + candidatesTokens,
        durationMs,
        costUsd,
        prompt,
        rawResponse,
        parsedOutput: output,
      });

      return output;
    } catch (err) {
      const durationMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : "ERROR / TIMEOUT";
      await this.appendCallLog({
        timestamp: new Date().toISOString(),
        requestId: requestId || `err-${Date.now()}`,
        model: this.model,
        solution: meta?.solution,
        constraint: meta?.constraint ?? params.constraint.id,
        promptTokens: Math.ceil(prompt.length / 4),
        candidatesTokens: 0,
        totalTokens: Math.ceil(prompt.length / 4),
        durationMs,
        costUsd: 0,
        prompt,
        rawResponse: `ERROR: ${errMsg}`,
        parsedOutput: { verdict: "unsure", evidence: [] },
      });
      return { verdict: "unsure", evidence: [] };
    } finally {
      clearTimeout(timeout);
    }
  }

  getCallLog(): CallLogEntry[] {
    return [...this.callLog];
  }
}
