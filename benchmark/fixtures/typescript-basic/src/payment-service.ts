import type { Gateway, Payment } from "./contracts.js";
export class PaymentService {
  constructor(private readonly gateway: Gateway) {}
  create(id: string): Payment { return this.gateway.charge(id); }
}
