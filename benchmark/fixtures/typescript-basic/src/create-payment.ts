import { PaymentService } from "./payment-service.js";
export function createPayment(service: PaymentService, id: string) {
  return service.create(id);
}
