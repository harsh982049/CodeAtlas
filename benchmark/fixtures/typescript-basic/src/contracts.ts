export interface Payment { id: string; }
export interface Gateway { charge(id: string): Payment; }
export type PaymentId = string;
