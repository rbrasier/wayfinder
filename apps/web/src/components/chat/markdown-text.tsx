"use client";

import { Fragment } from "react";
import { parseInline, parseMarkdownBlocks, type InlineNode, type MarkdownBlock } from "@rbrasier/domain";

interface MarkdownTextProps {
  content: string;
  // Bubble text colour, passed through from the caller so a user bubble stays
  // white-on-blue and an assistant bubble stays ink-on-white.
  className?: string;
}

function InlineNodes({ nodes }: { nodes: readonly InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          {node.type === "text" && node.value}
          {node.type === "bold" && (
            <strong className="font-semibold">
              <InlineNodes nodes={node.children} />
            </strong>
          )}
          {node.type === "italic" && (
            <em className="italic">
              <InlineNodes nodes={node.children} />
            </em>
          )}
          {node.type === "strike" && (
            <s className="line-through">
              <InlineNodes nodes={node.children} />
            </s>
          )}
          {node.type === "code" && (
            <code className="rounded-[4px] bg-black/10 px-[4px] py-px font-mono text-[0.92em]">
              {node.value}
            </code>
          )}
          {node.type === "link" && (
            <a
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              <InlineNodes nodes={node.children} />
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}

function Block({ block }: { block: MarkdownBlock }) {
  if (block.type === "code") {
    return (
      <pre className="overflow-x-auto rounded-[6px] bg-black/10 px-2 py-1.5 font-mono text-[0.92em]">
        <code>{block.value}</code>
      </pre>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag
        className={`ml-[1.1em] list-outside space-y-0.5 ${
          block.ordered ? "list-decimal" : "list-disc"
        }`}
      >
        {block.items.map((item, index) => (
          <li key={index}>
            <InlineNodes nodes={parseInline(item)} />
          </li>
        ))}
      </ListTag>
    );
  }

  // A heading keeps the bubble's own type size — the assistant emitting "## Title"
  // must not scale the conversation up — and reads as a bold lead-in instead.
  if (block.type === "heading") {
    return (
      <p className="font-semibold">
        <InlineNodes nodes={parseInline(block.content)} />
      </p>
    );
  }

  return (
    <p className="whitespace-pre-wrap">
      <InlineNodes nodes={parseInline(block.content)} />
    </p>
  );
}

export function MarkdownText({ content, className }: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(content);

  // Nothing parsed (whitespace-only content) — keep the raw string so the bubble
  // is never silently empty.
  if (blocks.length === 0) {
    return <div className={className}>{content}</div>;
  }

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
