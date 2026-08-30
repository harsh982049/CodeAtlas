export interface Gateway { charge(): void; }
export class BaseGateway { protected log(): void {} }
export class StripeGateway extends BaseGateway implements Gateway {
  charge(): void { this.log(); }
}
