import type { SessionFlavor } from "grammy";
import type { Context } from "grammy";
import type { PaymentMethod, ReceiptCalculationType } from "@receipt-bot/db";

export type AwaitingInput =
  | null
  | "registration_inn"
  | "registration_full_name"
  | "registration_address"
  | "registration_ogrn"
  | "profile_edit_inn"
  | "profile_edit_full_name"
  | "profile_edit_address"
  | "profile_edit_ogrn"
  | "service_add"
  | "receipt_price"
  | "receipt_quantity";

export interface RegistrationDraft {
  inn?: string;
  ipFullName?: string;
  ogrn?: string;
}

export interface ReceiptDraftItem { serviceId: number; quantity: string; price?: string }

export interface ReceiptDraft {
  items: ReceiptDraftItem[];
  editingItemIndex?: number;
  paymentMethod?: PaymentMethod;
  calculationType?: ReceiptCalculationType;
  submitted?: boolean;
}

export interface BotSession {
  awaitingInput: AwaitingInput;
  registrationDraft: RegistrationDraft;
  receiptDraft: ReceiptDraft | null;
}

export type BotContext = Context & SessionFlavor<BotSession>;
