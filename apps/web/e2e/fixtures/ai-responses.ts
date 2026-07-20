/**
 * fixtures/ai-responses.ts
 *
 * Canned AI responses used when USE_REAL_AI is not set.
 * These mimic the exact streaming format Wayfinder receives from each provider,
 * so the UI behaves identically — typing animation, complete message, etc.
 *
 * Format: Anthropic uses SSE (server-sent events) with data: JSON lines.
 * The Vercel AI SDK (used by Wayfinder) consumes this stream.
 */

/** Anthropic streaming SSE response for a simple chat reply */
export function anthropicStreamResponse(text: string): string {
  const chunks = text.match(/.{1,20}/g) ?? [text]; // split into ~20-char chunks
  const lines: string[] = [];

  lines.push(`data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-20250514', stop_reason: null } })}\n\n`);
  lines.push(`data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);

  for (const chunk of chunks) {
    lines.push(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })}\n\n`);
  }

  lines.push(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
  lines.push(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: chunks.length } })}\n\n`);
  lines.push(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);

  return lines.join('');
}

/** OpenAI-compatible streaming response (also used by Mistral) */
export function openaiStreamResponse(text: string): string {
  const chunks = text.match(/.{1,20}/g) ?? [text];
  const lines: string[] = [];
  const id = 'chatcmpl-test';

  for (const chunk of chunks) {
    lines.push(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    })}\n\n`);
  }

  lines.push(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`);
  lines.push('data: [DONE]\n\n');

  return lines.join('');
}

/** Pre-built canned responses for specific workflow steps */
export const MOCK_RESPONSES = {
  /** Generic greeting / first turn */
  greeting: "Hello! I'm here to help guide you through this workflow. Could you start by telling me your name and the organisation you're working with?",

  /** After user provides initial info */
  acknowledgement: "Thank you for that information. I've noted your details. Let's move on to the next step. Could you describe the main challenge you're trying to address?",

  /** When a document is being generated */
  documentGeneration: "I have all the information I need. I'm now generating your document — this will just take a moment.",

  /** Fallback for any other prompt */
  fallback: "I understand. Let me process that and guide you to the next step in the workflow.",
};
