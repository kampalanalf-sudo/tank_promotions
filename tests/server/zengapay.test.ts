import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GatewayError,
  collectPayment,
  disbursePayment,
  extractWebhookFields,
  fetchCollectionStatus,
  fetchTransferStatus,
  isValidZengaPhone,
  normalizeStatus,
  toZengaMsisdn,
  transactionMatches,
  verifyWebhookSignature,
  type ServerEnv,
} from "../../server/zengapay";

const env: ServerEnv = {
  ZENGAPAY_API_KEY: "ZPYPUBK-test_live_key_12345",
  ZENGAPAY_WEBHOOK_SECRET: "whsec_zenga_secret_hash",
  ZENGAPAY_BASE_URL: "https://api.sandbox.zengapay.com/v1",
};

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server ZengaPay REST v1 integration", () => {
  it("normalizes MSISDNs and maps ZengaPay transaction statuses", () => {
    expect(toZengaMsisdn("0775 203 801")).toBe("256775203801");
    expect(toZengaMsisdn("+256701234567")).toBe("256701234567");
    expect(toZengaMsisdn("0392123456")).toBe("256392123456");
    expect(isValidZengaPhone("256775203801")).toBe(true);
    expect(isValidZengaPhone("254712345678")).toBe(false);

    expect(normalizeStatus("PENDING")).toBe("pending");
    expect(normalizeStatus("INDETERMINATE")).toBe("pending");
    expect(normalizeStatus("SUCCEEDED")).toBe("completed");
    expect(normalizeStatus("FAILED")).toBe("failed");
  });

  it("collectPayment sends POST /v1/collections with Bearer auth and parses 202 transactionReference", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 202,
          status: "accepted",
          message: "Transaction Initiated",
          transactionReference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectPayment(env, {
      msisdn: "0775203801",
      amount: 20000,
      external_reference: "TNK-order-001",
      narration: "TANK Tickets TNK-ABCD2345",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sandbox.zengapay.com/v1/collections");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ZPYPUBK-test_live_key_12345");
    expect(JSON.parse(String(init.body))).toEqual({
      msisdn: "256775203801",
      amount: 20000,
      external_reference: "TNK-order-001",
      narration: "TANK Tickets TNK-ABCD2345",
    });
    expect(result.reference).toBe("7666749a-07c3-4f88-a069-277c50ac7f0f");
    expect(result.status).toBe("pending");
  });

  it("fetchCollectionStatus parses GET /v1/collections/{ref} and transactionMatches validates strictly", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 200,
          status: "OK",
          message: "Successfully Fetched Transaction",
          data: {
            transactionReference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
            transactionExternalReference: "TNK-order-001",
            transactionEntryGeneralType: "CREDIT",
            MNOTransactionReferenceId: "1234567890",
            paymentProvider: "MTN MOBILE MONEY",
            msisdn: "256775203801",
            currencyCode: "UGX",
            amount: 20000,
            charge: 500,
            transactionStatus: "SUCCEEDED",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tx = await fetchCollectionStatus(env, "7666749a-07c3-4f88-a069-277c50ac7f0f");
    expect(tx.status).toBe("SUCCEEDED");
    expect(tx.providerRef).toBe("1234567890");
    expect(
      transactionMatches(tx, {
        reference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
        amount: 20000,
        externalRef: "TNK-order-001",
        direction: "collect",
      }),
    ).toBe(true);
    expect(
      transactionMatches(tx, {
        reference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
        amount: 10000,
        externalRef: "TNK-order-001",
        direction: "collect",
      }),
    ).toBe(false);
    expect(
      transactionMatches(tx, {
        reference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
        amount: 20000,
        externalRef: "TNK-order-001",
        direction: "transfer",
      }),
    ).toBe(false);
  });

  it("disbursePayment & fetchTransferStatus handle /v1/transfers and surface 403 IP whitelist errors clearly", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 403, status: "Forbidden", message: "Connection refused from unauthorized IP" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            status: "OK",
            data: {
              transactionReference: "tx-transfer-1",
              transactionExternalReference: "PAY-1",
              transactionEntryGeneralType: "DEBIT",
              MNOTransactionReferenceId: "99887766",
              msisdn: "256775203801",
              currencyCode: "UGX",
              amount: 50000,
              transactionStatus: "SUCCEEDED",
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      disbursePayment(env, {
        msisdn: "256775203801",
        amount: 50000,
        external_reference: "PAY-1",
        narration: "Organizer payout",
      }),
    ).rejects.toMatchObject({
      code: "IP_NOT_WHITELISTED",
      status: 503,
    } satisfies Partial<GatewayError>);

    const transfer = await fetchTransferStatus(env, "tx-transfer-1");
    expect(transfer.entryType).toBe("DEBIT");
    expect(
      transactionMatches(transfer, {
        reference: "tx-transfer-1",
        amount: 50000,
        externalRef: "PAY-1",
        direction: "transfer",
      }),
    ).toBe(true);
  });

  it("verifyWebhookSignature validates all ZengaPay X-ZENGAPAY-SIGNATURE formats and rejects forgeries", async () => {
    const secret = "whsec_zenga_secret_hash";
    const payload = {
      event: "collection.success",
      data: {
        transactionReference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
        transactionExternalReference: "TNK-order-001",
        msisdn: "256775203801",
        amount: 20000,
        transactionStatus: "SUCCEEDED",
      },
    };
    const rawBody = JSON.stringify(payload);

    const sig2dp = await hmacSha256Hex(secret, "7666749a-07c3-4f88-a069-277c50ac7f0f25677520380120000.00");
    expect(await verifyWebhookSignature(rawBody, sig2dp, secret, payload)).toBe(true);

    const sigInt = await hmacSha256Hex(secret, "7666749a-07c3-4f88-a069-277c50ac7f0f25677520380120000");
    expect(await verifyWebhookSignature(rawBody, sigInt, secret, payload)).toBe(true);

    const sigRaw = await hmacSha256Hex(secret, rawBody);
    expect(await verifyWebhookSignature(rawBody, sigRaw, secret, payload)).toBe(true);

    expect(await verifyWebhookSignature(rawBody, "deadbeef".repeat(8), secret, payload)).toBe(false);
    expect(await verifyWebhookSignature(rawBody, null, secret, payload)).toBe(false);
    await expect(verifyWebhookSignature(rawBody, sig2dp, "", payload)).rejects.toBeInstanceOf(GatewayError);

    expect(extractWebhookFields(payload)).toMatchObject({
      event: "collection.success",
      reference: "7666749a-07c3-4f88-a069-277c50ac7f0f",
      externalReference: "TNK-order-001",
      isTransfer: false,
    });
  });
});
