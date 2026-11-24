type PaymentOrder = {
  amountMinor: number;
  currency: string;
  recipientAccountId: string;
};

type BankTransfer = PaymentOrder & {
  reference: string;
  direction: string;
  status: string;
};

export function transferMatchesOrder(order: PaymentOrder, transfer: BankTransfer): boolean {
  return (
    transfer.direction === 'incoming' &&
    transfer.status === 'settled' &&
    transfer.reference.trim().length > 0 &&
    transfer.amountMinor === order.amountMinor &&
    transfer.currency === order.currency &&
    transfer.recipientAccountId === order.recipientAccountId
  );
}
