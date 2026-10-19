"use client";

// Lightweight Markdown renderer for assistant answers.
//
// Model output is Markdown (`**bold**`, `- bullets`, fenced code, tables). The
// chat used to render it as literal text with `whitespace-pre-wrap`, so users saw
// raw asterisks and hyphens. This renders the same text as real typography —
// no new dependency, no dangerouslySetInnerHTML, so nothing can inject HTML.

import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; head: string[]; rows: string[][] };

const FENCE = /^```([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:-]+\|[\s:|-]*$/;

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
}

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push({ kind: "code", lang: fence[1] || "", code: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        parts.push(QUOTE.exec(lines[index])![1]);
        index += 1;
      }
      blocks.push({ kind: "quote", text: parts.join(" ") });
      continue;
    }

    // GFM table: header row followed by a divider row.
    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (match) {
          items.push((ordered ? match[2] : match[1]).trim());
          index += 1;
          continue;
        }
        // Continuation of the previous item (indented, non-empty line).
        if (items.length && current.trim() && !BULLET.test(current) && !NUMBERED.test(current)) {
          items[items.length - 1] += " " + current.trim();
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index];
      if (
        FENCE.test(current) ||
        HEADING.test(current) ||
        RULE.test(current) ||
        QUOTE.test(current) ||
        BULLET.test(current) ||
        NUMBERED.test(current) ||
        TABLE_ROW.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    else index += 1;
  }

  return blocks;
}

/** Inline formatting: `code`, **bold**, *italic*, ~~strike~~ and [links](url). */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^\s)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let counter = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${counter++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded-md border border-white/12 bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.86em] text-cyan-100">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {inline(token.slice(2, -2), key)}
        </strong>,
      );
    } else if (token.startsWith("~~")) {
      nodes.push(
        <s key={key} className="text-white/45">
          {inline(token.slice(2, -2), key)}
        </s>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(
        <em key={key} className="italic text-white/90">
          {inline(token.slice(1, -1), key)}
        </em>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token)!;
      nodes.push(
        <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-cyan-200 underline decoration-cyan-200/40 underline-offset-2 hover:decoration-cyan-200">
          {link[1]}
        </a>,
      );
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_STYLES = [
  "mt-5 mb-2 text-lg font-semibold text-white first:mt-0",
  "mt-4 mb-2 text-base font-semibold text-white first:mt-0",
  "mt-4 mb-1.5 text-[15px] font-semibold text-white/95 first:mt-0",
];

export function Markdown({ content }: { content: string }) {
  const blocks = parse(content);

  return (
    <div className="space-y-3 break-words">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "heading":
            return (
              <p key={key} className={HEADING_STYLES[Math.min(block.level, 3) - 1]}>
                {inline(block.text, key)}
              </p>
            );
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3.5 text-[13px] leading-6">
                <code className="font-mono text-cyan-50/90">{block.code}</code>
              </pre>
            );
          case "rule":
            return <hr key={key} className="border-white/10" />;
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-cyan-200/40 pl-3 text-white/70">
                {inline(block.text, key)}
              </blockquote>
            );
          case "list":
            return block.ordered ? (
              <ol key={key} className="ml-1 space-y-1.5">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`} className="flex gap-2.5">
                    <span className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[11px] font-medium text-cyan-100">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">{inline(item, `${key}-${i}`)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="ml-1 space-y-1.5">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`} className="flex gap-2.5">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-200/70" />
                    <span className="min-w-0 flex-1">{inline(item, `${key}-${i}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full border-collapse text-left text-[13.5px]">
                  <thead className="bg-white/[0.05] text-white/70">
                    <tr>
                      {block.head.map((cell, i) => (
                        <th key={i} className="px-3 py-2 font-medium">
                          {inline(cell, `${key}-h${i}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-t border-white/8">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-2 text-white/80">
                            {inline(cell, `${key}-${r}-${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={key} className="leading-7">
                {inline(block.text, key)}
              </p>
            );
        }
      })}
      {/* Keeps trailing whitespace meaningful for streamed, partial answers. */}
      <Fragment />
    </div>
  );
}
