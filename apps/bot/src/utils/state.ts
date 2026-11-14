import type { BotSession } from "../types";

export const createInitialSession = (): BotSession => ({
  awaitingInput: null,
  registrationDraft: {},
  receiptDraft: null
});

export const clearBrandingDraft = (session: BotSession): void => {
  delete session.brandingDraft;
  if (session.awaitingInput?.startsWith("branding_")) session.awaitingInput = null;
};

/** Leaving the support screen (any button or command) cancels the pending support message. */
export const clearSupportInput = (session: BotSession): void => {
  if (session.awaitingInput === "support_message") session.awaitingInput = null;
};

export const clearReceiptDraft = (session: BotSession): void => {
  session.receiptDraft = null;
  if (session.awaitingInput === "receipt_custom_service" || session.awaitingInput === "receipt_price" || session.awaitingInput === "receipt_quantity") {
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
