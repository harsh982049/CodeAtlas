import { sharedValue } from "@fixture/ref-shared";

export function renderValue(): number {
  return sharedValue();
}
