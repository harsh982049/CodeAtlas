import type ts from "typescript";

import type { EdgeEvidence } from "@codeatlas/codegraph";
import type { NormalizedRelativePath, SourceLocation } from "@codeatlas/shared";

export function nodeLocation(
  filePath: NormalizedRelativePath,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    filePath,
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
  };
}

export function nodeEvidence(
  filePath: NormalizedRelativePath,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: EdgeEvidence["kind"],
): EdgeEvidence {
  return { ...nodeLocation(filePath, sourceFile, node), kind };
}
