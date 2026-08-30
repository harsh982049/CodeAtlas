import { charge as collectPayment } from "./payments.js";
export function checkout(): string { return collectPayment(); }
