import type { NormalizedRelativePath } from "./paths.js";

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceLocation {
  readonly filePath: NormalizedRelativePath;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export function assertSourcePosition(position: SourcePosition): void {
  if (
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.column) ||
    position.line < 1 ||
    position.column < 1
  ) {
    throw new RangeError("Source positions are one-based positive integers");
  }
}

export function assertSourceLocation(location: SourceLocation): void {
  assertSourcePosition(location.start);
  assertSourcePosition(location.end);

  if (
    location.end.line < location.start.line ||
    (location.end.line === location.start.line &&
      location.end.column < location.start.column)
  ) {
    throw new RangeError("Source location end must not precede its start");
  }
}

