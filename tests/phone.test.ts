import { describe, expect, it } from "vitest";
import { cleanPhone, detectNetwork, isValidGatewayPhone, toMsisdn } from "../src/lib/phone";

describe("Uganda ZengaPay Mobile Money phone helpers", () => {
  it("normalizes Ugandan numbers into 12-digit 256... MSISDN format", () => {
    expect(cleanPhone("+256 772-123 456")).toBe("+256772123456");
    expect(toMsisdn("0772 123 456")).toBe("256772123456");
    expect(toMsisdn("+256 755 123456")).toBe("256755123456");
    expect(toMsisdn("760123456")).toBe("256760123456");
    expect(toMsisdn("0392123456")).toBe("256392123456");
    expect(toMsisdn("0200123456")).toBe("256200123456");
  });

  it("detects MTN Uganda vs Airtel Uganda prefixes", () => {
    expect(detectNetwork("0772123456")).toBe("MTN");
    expect(detectNetwork("+256782123456")).toBe("MTN");
    expect(detectNetwork("0760123456")).toBe("MTN");
    expect(detectNetwork("0392123456")).toBe("MTN");
    expect(detectNetwork("0701123456")).toBe("Airtel");
    expect(detectNetwork("+256755123456")).toBe("Airtel");
    expect(detectNetwork("0740123456")).toBe("Airtel");
    expect(detectNetwork("0200123456")).toBe("Airtel");
  });

  it("accepts only supported Ugandan MTN and Airtel Mobile Money numbers", () => {
    expect(isValidGatewayPhone("0772123456")).toBe(true);
    expect(isValidGatewayPhone("+256755123456")).toBe(true);
    expect(isValidGatewayPhone("256760123456")).toBe(true);
    expect(isValidGatewayPhone("0392123456")).toBe(true);
    expect(isValidGatewayPhone("0200123456")).toBe(true);
    expect(isValidGatewayPhone("+254712345678")).toBe(false);
    expect(isValidGatewayPhone("+255712345678")).toBe(false);
    expect(isValidGatewayPhone("0414123456")).toBe(false);
    expect(isValidGatewayPhone("077212345")).toBe(false);
  });
});
