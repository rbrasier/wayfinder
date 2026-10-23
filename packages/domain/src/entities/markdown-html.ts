import { parseInline, parseMarkdownBlocks, type InlineNode, type MarkdownBlock } from "./markdown";

// The same markdown subset the chat renders, as an HTML string for email
// bodies (ADR-065 §6a). Every piece of text is escaped, so a value substituted
// into the message can never add markup; only the parser's own nodes do.

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderInline = (nodes: InlineNode[]): string => nodes.map(renderInlineNode).join("");

const renderInlineNode = (node: InlineNode): string => {
  if (node.type === "text") return escapeHtml(node.value).replace(/\n/g, "<br>");
  if (node.type === "code") return `<code>${escapeHtml(node.value)}</code>`;
  if (node.type === "link") return `<a href="${escapeHtml(node.href)}">${renderInline(node.children)}</a>`;
  if (node.type === "bold") return `<strong>${renderInline(node.children)}</strong>`;
  if (node.type === "italic") return `<em>${renderInline(node.children)}</em>`;
  return `<s>${renderInline(node.children)}</s>`;
};

const renderBlock = (block: MarkdownBlock): string => {
  if (block.type === "heading") return `<h3>${renderInline(parseInline(block.content))}</h3>`;
  if (block.type === "paragraph") return `<p>${renderInline(parseInline(block.content))}</p>`;
  if (block.type === "code") return `<pre><code>${escapeHtml(block.value)}</code></pre>`;
  const tag = block.ordered ? "ol" : "ul";
  const items = block.items.map((item) => `<li>${renderInline(parseInline(item))}</li>`).join("");
  return `<${tag}>${items}</${tag}>`;
};

export const renderMarkdownToHtml = (markdown: string): string =>
  parseMarkdownBlocks(markdown).map(renderBlock).join("");
