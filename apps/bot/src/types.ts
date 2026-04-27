import type { SessionFlavor } from "grammy";
import type { Context } from "grammy";
import type { PaymentMethod } from "@receipt-bot/db";

export type AwaitingInput =
  | null
  | "registration_inn"
  | "registration_full_name"
  | "registration_address"
  | "profile_edit_inn"
  | "profile_edit_full_name"
  | "profile_edit_address"
  | "service_add"
  | "receipt_amount";

export interface RegistrationDraft {
  inn?: string;
  ipFullName?: string;
}

export interface ReceiptDraft {
  serviceId?: number;
  amount?: string;
  paymentMethod?: PaymentMethod;
  submitted?: boolean;
}

export interface BotSession {
  awaitingInput: AwaitingInput;
  registrationDraft: RegistrationDraft;
  receiptDraft: ReceiptDraft | null;
}

export type BotContext = Context & SessionFlavor<BotSession>;
