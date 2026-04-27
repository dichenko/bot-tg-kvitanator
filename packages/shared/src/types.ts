export type PaymentMethodValue = "CASH" | "BANK_TRANSFER";

export type OperationStatusValue =
  | "DRAFT"
  | "CONFIRMED"
  | "RENDERING"
  | "RENDERED"
  | "SENT"
  | "FAILED"
  | "DELETED";

export type ExportRangeKey = "today" | "current_month" | "previous_month" | "all_time";

export interface RenderReceiptRequest {
  operationId: number;
  receiptNumber: string;
  createdAt: string;
  inn: string;
  ipFullName: string;
  address: string;
  serviceTitle: string;
  amount: string;
  paymentMethod: PaymentMethodValue;
}

export interface RenderReceiptResponse {
  ok: boolean;
  imagePath?: string;
  error?: string;
}
