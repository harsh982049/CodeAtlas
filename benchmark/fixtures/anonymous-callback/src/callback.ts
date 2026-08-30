export function invoke(callback: () => number): number { return callback(); }
export const result = invoke(() => 1);
