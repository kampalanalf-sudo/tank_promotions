export type CheckoutMode =
  | { kind: "hosted"; url: string }
  | { kind: "internal" };

/**
 * Paid events can use DGateway's hosted store instead of the in-app API checkout.
 * Free events always stay in the internal checkout because no payment is needed.
 */
export function checkoutModeFor(price: number, hostedStoreUrl: string, productCheckoutUrl?: string): CheckoutMode {
  const storeUrl = hostedStoreUrl.trim();
  const productUrl = productCheckoutUrl?.trim();
  if (price > 0 && storeUrl) return { kind: "hosted", url: productUrl || storeUrl };
  return { kind: "internal" };
}
