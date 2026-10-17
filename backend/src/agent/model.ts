import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration } from '@google/genai';

/** A tool the model may choose, taken straight from the MCP server's tools/list. */
export interface ModelTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export type ModelStep = { kind: 'tool_calls'; calls: ModelToolCall[] } | { kind: 'text'; text: string };

export interface ModelToolResult {
  call: ModelToolCall;
  result: unknown;
}

/** One conversation with the model. It keeps its own history. */
export interface AgentModelRun {
  step(signal: AbortSignal): Promise<ModelStep>;
  addToolResults(results: ModelToolResult[]): void;
  addUserText(text: string): void;
}

/** The only thing the agent needs from a language model. Swap the implementation to change vendor. */
export interface AgentModel {
  readonly name: string;
  start(options: { system: string; goal: string; tools: ModelTool[] }): AgentModelRun;
}

export const GEMINI_MODEL = 'gemini-3.8-flash';
const ATTEMPT_TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

export class ModelUnavailableError extends Error {}

/** Gemini through the Google GenAI SDK. The model sees only the StepFree MCP tools: no search, maps or code tools. */
export class GeminiAgentModel implements AgentModel {
  readonly name: string;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, model = GEMINI_MODEL) {
    this.name = model;
    this.ai = new GoogleGenAI({ apiKey });
  }

  start({ system, goal, tools }: { system: string; goal: string; tools: ModelTool[] }): AgentModelRun {
    const declarations: FunctionDeclaration[] = tools.map((tool) => {
      const { $schema: _ignored, ...schema } = tool.inputSchema as Record<string, unknown>;
      return { name: tool.name, description: tool.description, parametersJsonSchema: schema };
    });
    const contents: Content[] = [{ role: 'user', parts: [{ text: goal }] }];
    const { ai, name } = this;
    return {
      async step(signal) {
        // Gemini occasionally stalls on a request that would normally return in a few seconds. Retry a stalled or
        // transiently failed request (never one rejected with a 4xx, such as a bad key or an exhausted quota) with a fresh request and a short per-attempt timeout.
        let response;
        let lastError = 'Gemini request failed';
        for (let attempt = 0; attempt < ATTEMPTS && !response; attempt++) {
          try {
            response = await ai.models.generateContent({
              model: name,
              contents,
              config: {
                systemInstruction: system,
                tools: [{ functionDeclarations: declarations }],
                toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                maxOutputTokens: 1024,
                abortSignal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
              },
            });
          } catch (error) {
            lastError = error instanceof Error ? error.message : lastError;
            // 4xx (invalid request or key, quota exhausted) will not succeed on retry.
            if (signal.aborted || /4\d\d/.test(lastError)) break;
          }
        }
        if (!response) throw new ModelUnavailableError(lastError);
        const content = response.candidates?.[0]?.content;
        if (!content) throw new ModelUnavailableError('Gemini returned no content');
        // The model's own turn goes back into the history unchanged (Gemini needs its thought signatures).
        contents.push(content);
        const calls = (response.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? '', args: (c.args ?? {}) as Record<string, unknown> }));
        if (calls.length > 0) return { kind: 'tool_calls', calls };
        return { kind: 'text', text: response.text ?? '' };
      },
      addToolResults(results) {
        contents.push({
          role: 'user',
          parts: results.map(({ call, result }) => ({
            functionResponse: { id: call.id, name: call.name, response: { output: result } },
          })),
        });
      },
      addUserText(text) {
        contents.push({ role: 'user', parts: [{ text }] });
      },
    };
  }
}
