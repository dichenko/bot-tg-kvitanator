export type PaymentMethodValue = "CASH" | "BANK_TRANSFER";
export type ReceiptCalculationTypeValue = "INCOME" | "INCOME_RETURN";

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
  ogrn?: string | null;
  calculationType: ReceiptCalculationTypeValue;
  items: Array<{ title: string; quantity: string; price: string; amount: string }>;
  amount: string;
  paymentMethod: PaymentMethodValue;
}

export interface RenderReceiptResponse {
  ok: boolean;
  imagePath?: string;
  error?: string;
}
