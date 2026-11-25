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
  fallbackModel?: string | undefined;
  logFilePath?: string | undefined;
  timeoutMs?: number | undefined;
}

export class GeminiModelClient implements ModelClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModel: string;
  private readonly logFilePath?: string | undefined;
  private readonly timeoutMs: number;
  private readonly callLog: CallLogEntry[] = [];

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const envFallback = process.env.GEMINI_FALLBACK_MODEL;
    const defaultFallback =
      this.model === "gemini-3.8-flash"
        ? "gemini-3.6-flash,gemini-3-flash-preview,gemini-flash-lite-latest"
        : this.model === "gemini-3.6-flash"
          ? "gemini-3-flash-preview,gemini-flash-lite-latest"
          : "";
    this.fallbackModel = options.fallbackModel ?? (envFallback || defaultFallback);
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

  private async callSingleModel(
    modelName: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<{
    ok: boolean;
    status: number;
    requestId: string;
    modelVersion: string;
    rawResponse: string;
    promptTokens: number;
    candidatesTokens: number;
    output: ModelOutput;
  }> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
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
      // keep empty data
    }

    const requestId = headerReqId || data.responseId || `http-${res.status}-${Date.now()}`;
    const modelVersion = data.modelVersion ?? modelName;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        requestId,
        modelVersion,
        rawResponse: `HTTP ${res.status}: ${rawBodyText.slice(0, 500)}`,
        promptTokens: Math.ceil(prompt.length / 4),
        candidatesTokens: 0,
        output: { verdict: "unsure", evidence: [] },
      };
    }

    const rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ?? rawBodyText;
    const promptTokens = data.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
    const candidatesTokens =
      data.usageMetadata?.candidatesTokenCount ?? Math.ceil(rawResponse.length / 4);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      parsed = null;
    }

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

    return {
      ok: true,
      status: res.status,
      requestId,
      modelVersion,
      rawResponse,
      promptTokens,
      candidatesTokens,
      output,
    };
  }

  async call(params: ConstraintPromptParams, meta?: CallMetadata): Promise<ModelOutput> {
    const prompt = buildModelPrompt(params);
    const start = Date.now();

    if (!this.apiKey) {
      return { verdict: "unsure", evidence: [] };
    }

    const controller = new AbortController();
    const deadline = Date.now() + this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const candidates = [
        this.model,
        ...this.fallbackModel
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.length > 0 && m !== this.model),
      ];
      let result: Awaited<ReturnType<GeminiModelClient["callSingleModel"]>> | undefined;
      let lastError: Error | undefined;

      // Give each candidate its own attempt timer inside the total timeoutMs budget
      // so a hanging primary model still leaves time to fall back.
      for (const [idx, candidateModel] of candidates.entries()) {
        if (controller.signal.aborted) break;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 200) break;

        const isLast = idx === candidates.length - 1;
        const attemptMs = isLast
          ? remainingMs
          : Math.min(remainingMs, Math.max(100, Math.floor(remainingMs * 0.45)));
        const attemptController = new AbortController();
        const onParentAbort = (): void => attemptController.abort();
        controller.signal.addEventListener("abort", onParentAbort, { once: true });
        const attemptTimeout = setTimeout(() => attemptController.abort(), attemptMs);

        try {
          const attemptResult = await this.callSingleModel(
            candidateModel,
            prompt,
            attemptController.signal,
          );
          result = attemptResult;
          lastError = undefined;
          const retryable =
            !attemptResult.ok &&
            (!attemptResult.status ||
              attemptResult.status === 503 ||
              attemptResult.status === 429 ||
              attemptResult.status === 404 ||
              attemptResult.status >= 500);
          if (!retryable || isLast || controller.signal.aborted) {
            break;
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (isLast || controller.signal.aborted) {
            throw lastError;
          }
        } finally {
          clearTimeout(attemptTimeout);
          controller.signal.removeEventListener("abort", onParentAbort);
        }
      }

      if (!result) {
        if (lastError !== undefined) throw lastError;
        throw new Error("This operation was aborted");
      }

      const durationMs = Date.now() - start;
      // Cost arithmetic: $0.075 / 1M input tokens, $0.30 / 1M output tokens
      const costUsd =
        (result.promptTokens * 0.075) / 1_000_000 + (result.candidatesTokens * 0.3) / 1_000_000;

      await this.appendCallLog({
        timestamp: new Date().toISOString(),
        requestId: result.requestId,
        model: result.modelVersion,
        solution: meta?.solution,
        constraint: meta?.constraint ?? params.constraint.id,
        promptTokens: result.promptTokens,
        candidatesTokens: result.candidatesTokens,
        totalTokens: result.promptTokens + result.candidatesTokens,
        durationMs,
        costUsd,
        prompt,
        rawResponse: result.rawResponse,
        parsedOutput: result.output,
      });

      return result.output;
    } catch (err) {
      const durationMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : "ERROR / TIMEOUT";
      await this.appendCallLog({
        timestamp: new Date().toISOString(),
        requestId: `err-${Date.now()}`,
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
