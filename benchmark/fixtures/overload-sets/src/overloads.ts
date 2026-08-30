export function parse(value: string): string;
export function parse(value: number): number;
export function parse(value: string | number): string | number {
  return value;
}

export class Parser {
  run(value: string): string;
  run(value: number): number;
  run(value: string | number): string | number {
    return parse(value);
  }
}

export function useParser(): string {
  return parse("value");
}
