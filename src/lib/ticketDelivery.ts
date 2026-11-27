export type TicketDeliveryChannelStatus = "pending" | "sent" | "failed" | "skipped";

export type TicketDelivery = {
  order_id: string;
  email_status: TicketDeliveryChannelStatus;
  whatsapp_status: TicketDeliveryChannelStatus;
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

export type TicketDeliveryStatus = {
  ok?: boolean;
  error?: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  email_from: string;
  whatsapp_template: string;
  whatsapp_language: string;
  public_url: string;
};

export type TicketDeliveryResult = {
  ok?: boolean;
  error?: string;
  order_id: string;
  code: string;
  email_status: TicketDeliveryChannelStatus;
  whatsapp_status: TicketDeliveryChannelStatus;
  pdf_url?: string;
  email_last_error?: string;
  whatsapp_last_error?: string;
};
