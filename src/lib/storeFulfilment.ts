export type HostedTicketProduct = {
  event_id: string;
  product_id: string;
  product_slug: string;
  checkout_url: string;
  unit_amount: number;
  currency: string;
  tickets_per_unit: number;
};

export type StoreMapping = HostedTicketProduct & {
  id: string;
  store_slug: string;
  label: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type StoreMappingInput = {
  id?: string;
  store_slug: string;
  product_id: string;
  product_slug: string;
  event_id: string;
  label: string;
  unit_amount: number;
  currency: string;
  tickets_per_unit: number;
  checkout_url: string;
  enabled: boolean;
};

export type StorePayment = {
  reference: string;
  store_slug: string;
  product_id: string;
  product_slug: string;
  event_id: string | null;
  order_id: string | null;
  payment_status: "pending" | "completed" | "failed";
  fulfilment_status: "pending" | "issued" | "blocked" | "not_required";
  error_code: string;
  amount: number;
  currency: string;
  quantity: number | null;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  provider: string;
  provider_ref: string;
  failure_reason: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StoreTicket = {
  code: string;
  event_title: string;
  starts_at: string;
  venue: string;
  area: string;
  name: string;
  qty: number;
  amount: number;
  status: "SUCCEEDED" | "CHECKED_IN";
};

export type TicketDelivery = {
  order_id: string;
  email_status: "pending" | "sent" | "failed" | "skipped";
  whatsapp_status: "pending" | "sent" | "failed" | "skipped";
  email_attempts: number;
  whatsapp_attempts: number;
  email_last_error: string;
  whatsapp_last_error: string;
  email_sent_at: string | null;
  whatsapp_sent_at: string | null;
  pdf_path: string;
  created_at: string;
  updated_at: string;
};

export type TicketDeliveryResult = {
  ok?: boolean;
  order_id?: string;
  code?: string;
  email_status?: TicketDelivery["email_status"];
  whatsapp_status?: TicketDelivery["whatsapp_status"];
  pdf_url?: string;
  email_last_error?: string;
  whatsapp_last_error?: string;
  error?: string;
};

export type TicketDeliveryStatus = {
  ok?: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  email_from: string;
  whatsapp_template: string;
  whatsapp_language: string;
  public_url: string;
  error?: string;
};

export function storeWebhookUrl(supabaseUrl: string) {
  return supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/dgateway-store-webhook` : "";
}

export function validateStoreMapping(input: StoreMappingInput): string | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.product_id)) return "Enter the DGateway product ID.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.product_slug)) return "Enter the DGateway product slug.";
  if (!input.event_id) return "Choose the Tank Tickets event.";
  if (!Number.isInteger(input.unit_amount) || input.unit_amount <= 0) return "Enter a positive whole-unit product price.";
  if (!["UGX", "KES", "TZS", "RWF", "USD"].includes(input.currency)) return "Choose a supported currency.";
  if (!Number.isInteger(input.tickets_per_unit) || input.tickets_per_unit < 1 || input.tickets_per_unit > 10) return "Tickets per product must be 1 to 10.";
  try {
    const url = new URL(input.checkout_url);
    if (url.protocol !== "https:") return "Checkout URL must use https.";
  } catch {
    return "Enter a valid https checkout URL.";
  }
  return null;
}
