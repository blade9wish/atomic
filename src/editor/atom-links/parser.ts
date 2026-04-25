import type { Text } from '@codemirror/state';
import type { ParsedAtomLink } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

interface FenceState {
  marker: '`' | '~' | null;
  length: number;
}

interface InlineCodeSpan {
  from: number;
  to: number;
}

export function isUuidLike(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function findAtomLinksInVisibleRanges(doc: Text, ranges: readonly { from: number; to: number }[]): ParsedAtomLink[] {
  const links: ParsedAtomLink[] = [];

  for (const range of ranges) {
    const firstLine = doc.lineAt(range.from);
    const lastLine = doc.lineAt(Math.max(range.from, range.to - 1));
    const fence = fenceStateBeforeLine(doc, firstLine.number);

    for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber++) {
      const line = doc.line(lineNumber);
      const text = line.text;
      const fenceMatch = text.match(FENCE_RE);

      if (!fence.marker && fenceMatch) {
        fence.marker = fenceMatch[1][0] as '`' | '~';
        fence.length = fenceMatch[1].length;
        continue;
      }

      if (fence.marker) {
        if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length) {
          fence.marker = null;
          fence.length = 0;
        }
        continue;
      }

      links.push(...findAtomLinksInLine(text, line.from));
    }
  }

  return links;
}

function fenceStateBeforeLine(doc: Text, lineNumber: number): FenceState {
  const fence: FenceState = { marker: null, length: 0 };

  for (let current = 1; current < lineNumber; current++) {
    const match = doc.line(current).text.match(FENCE_RE);
    if (!match) continue;

    const marker = match[1][0] as '`' | '~';
    const length = match[1].length;
    if (!fence.marker) {
      fence.marker = marker;
      fence.length = length;
    } else if (marker === fence.marker && length >= fence.length) {
      fence.marker = null;
      fence.length = 0;
    }
  }

  return fence;
}

function findAtomLinksInLine(text: string, lineStart: number): ParsedAtomLink[] {
  const links: ParsedAtomLink[] = [];
  const codeSpans = inlineCodeSpans(text);
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const open = text.indexOf('[[', searchFrom);
    if (open === -1) break;

    if (isInsideAny(open, codeSpans)) {
      searchFrom = open + 2;
      continue;
    }

    const close = text.indexOf(']]', open + 2);
    if (close === -1) break;

    if (isInsideAny(close, codeSpans)) {
      searchFrom = close + 2;
      continue;
    }

    const body = text.slice(open + 2, close);
    const pipe = body.indexOf('|');
    const rawTarget = pipe === -1 ? body : body.slice(0, pipe);
    const rawLabel = pipe === -1 ? null : body.slice(pipe + 1);
    const targetStartInLine = open + 2 + leadingWhitespaceLength(rawTarget);
    const target = rawTarget.trim();

    if (!target) {
      searchFrom = close + 2;
      continue;
    }

    let label: string | null = null;
    let labelFrom: number | null = null;
    let labelTo: number | null = null;

    if (rawLabel != null) {
      const labelStart = leadingWhitespaceLength(rawLabel);
      const labelEnd = rawLabel.length - trailingWhitespaceLength(rawLabel);
      label = rawLabel.slice(labelStart, labelEnd);
      labelFrom = lineStart + open + 2 + pipe + 1 + labelStart;
      labelTo = lineStart + open + 2 + pipe + 1 + labelEnd;
    }

    links.push({
      from: lineStart + open,
      to: lineStart + close + 2,
      targetFrom: lineStart + targetStartInLine,
      targetTo: lineStart + targetStartInLine + target.length,
      labelFrom,
      labelTo,
      closeFrom: lineStart + close,
      target,
      label,
      isUuidTarget: isUuidLike(target),
    });

    searchFrom = close + 2;
  }

  return links;
}

function inlineCodeSpans(text: string): InlineCodeSpan[] {
  const spans: InlineCodeSpan[] = [];
  let pos = 0;

  while (pos < text.length) {
    const start = text.indexOf('`', pos);
    if (start === -1) break;

    let tickCount = 1;
    while (text[start + tickCount] === '`') tickCount++;

    const needle = '`'.repeat(tickCount);
    const end = text.indexOf(needle, start + tickCount);
    if (end === -1) break;

    spans.push({ from: start, to: end + tickCount });
    pos = end + tickCount;
  }

  return spans;
}

function isInsideAny(pos: number, spans: readonly InlineCodeSpan[]): boolean {
  return spans.some((span) => pos >= span.from && pos < span.to);
}

function leadingWhitespaceLength(value: string): number {
  const match = value.match(/^\s*/);
  return match?.[0].length ?? 0;
}

function trailingWhitespaceLength(value: string): number {
  const match = value.match(/\s*$/);
  return match?.[0].length ?? 0;
}
