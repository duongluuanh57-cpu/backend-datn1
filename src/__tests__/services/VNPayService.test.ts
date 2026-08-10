import { describe, it, expect } from "vitest";
import { createPaymentUrl, verifyIpnResponse, verifyReturnParams, getReturnUrl, getTmnCode } from "../../services/VNPayService.ts";

describe("VNPayService", () => {
  describe("createPaymentUrl", () => {
    it("should generate a valid payment URL", () => {
      const url = createPaymentUrl({
        txnRef: "ORDER123",
        amount: 500000,
        orderInfo: "Test order",
        ipAddr: "127.0.0.1",
        locale: "vn",
      });

      expect(url).toBeDefined();
      expect(url).toContain("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html");
      expect(url).toContain("vnp_TxnRef=ORDER123");
      expect(url).toContain("vnp_Amount=50000000");
      expect(url).toContain("vnp_SecureHash");
    });

    it("should include bank code when provided", () => {
      const url = createPaymentUrl({
        txnRef: "ORDER456",
        amount: 100000,
        orderInfo: "Bank transfer",
        ipAddr: "192.168.1.1",
        bankCode: "NCB",
      });

      expect(url).toContain("vnp_BankCode=NCB");
    });

    it("should use English locale when specified", () => {
      const url = createPaymentUrl({
        txnRef: "ORDER789",
        amount: 200000,
        orderInfo: "English order",
        ipAddr: "10.0.0.1",
        locale: "en",
      });

      expect(url).toContain("vnp_Locale=en");
    });
  });

  describe("verifyIpnResponse", () => {
    it("should return invalid for missing secure hash", () => {
      const result = verifyIpnResponse({ whatever: "value" });
      expect(result.isValid).toBe(false);
      expect(result.message).toBe("Missing vnp_SecureHash");
      expect(result.txnRef).toBeNull();
    });

    it("should return invalid for invalid checksum", () => {
      const params: Record<string, string> = {
        vnp_Amount: "10000000",
        vnp_TxnRef: "ORDER123",
        vnp_TransactionNo: "12345678",
        vnp_ResponseCode: "00",
        vnp_BankCode: "NCB",
        vnp_PayDate: "20240101120000",
        vnp_SecureHash: "this-is-definitely-wrong",
      };
      const result = verifyIpnResponse(params);
      expect(result.isValid).toBe(false);
      expect(result.message).toBe("Invalid checksum");
      expect(result.txnRef).toBe("ORDER123");
    });
  });

  describe("getReturnUrl & getTmnCode", () => {
    it("should return configured return URL", () => {
      const url = getReturnUrl();
      expect(url).toBe("http://localhost:3000/payment/return");
    });

    it("should return configured TMN code from env", () => {
      const code = getTmnCode();
      expect(code).toBe("TESTCODE");
    });
  });

  describe("verifyReturnParams", () => {
    it("should delegate to verifyIpnResponse", () => {
      const result = verifyReturnParams({});
      expect(result.isValid).toBe(false);
      expect(result.message).toBe("Missing vnp_SecureHash");
    });
  });
});
