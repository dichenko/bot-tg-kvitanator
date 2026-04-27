import type { BotSession } from "../types";

export const createInitialSession = (): BotSession => ({
  awaitingInput: null,
  registrationDraft: {},
  receiptDraft: null
});

export const clearReceiptDraft = (session: BotSession): void => {
  session.receiptDraft = null;
  if (session.awaitingInput === "receipt_amount") {
    session.awaitingInput = null;
  }
};

export const clearRegistrationDraft = (session: BotSession): void => {
  session.registrationDraft = {};
  if (
    session.awaitingInput === "registration_inn" ||
    session.awaitingInput === "registration_full_name" ||
    session.awaitingInput === "registration_address"
  ) {
    session.awaitingInput = null;
  }
};
