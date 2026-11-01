import { generateId, type UIMessageStreamWriter } from "ai";
import type { TurnStreamAnnotation, TurnStreamWriter } from "@wayfinder/domain";
import type { ChatUiMessage } from "@/lib/chat/ui-messages";

// The `ai`-SDK adapter for the TurnStreamWriter port: the single place that maps
// the port's semantic operations onto the AI SDK 5 UI message stream. Keeping
// this the only file in the stream path that writes stream chunks lets the turn
// orchestration depend on the framework-free port instead.
export class UiMessageStreamTurnWriter implements TurnStreamWriter {
  // The text part currently open on the client; each one renders as a bubble.
  private openTextId: string | null = null;

  constructor(
    private readonly stream: UIMessageStreamWriter<ChatUiMessage>,
    private readonly nextId: () => string = generateId,
  ) {}

  writeText(text: string): void {
    if (this.openTextId === null) {
      this.openTextId = this.nextId();
      this.stream.write({ type: "text-start", id: this.openTextId });
    }
    this.stream.write({ type: "text-delta", id: this.openTextId, delta: text });
  }

  endBubble(): void {
    if (this.openTextId === null) return;
    this.stream.write({ type: "text-end", id: this.openTextId });
    this.openTextId = null;
  }

  writeAnnotation(annotation: TurnStreamAnnotation): void {
    this.stream.write({ type: "data-turn-annotation", data: annotation });
  }
}
