import * as crypto from 'crypto';

/**
 * VNPAY Integration Service (Sandbox)
 *
 * Tài liệu tham khảo:
 * https://sandbox.vnpayment.vn/apis/docs/huong-dan-tich-hop/
 *
 * QUAN TRỌNG:
 * - Hash được tính trên query string với keys và values ĐÃ URL-ENCODE, các param SẮP XẾP A-Z
 * - vnp_SecureHash KHÔNG được đưa vào hash
 */

const VNPAY_TMN_CODE = process.env.VNPAY_TMN_CODE || '';
const VNPAY_HASH_SECRET = process.env.VNPAY_HASH_SECRET || '';
const VNPAY_URL = process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const VNPAY_RETURN_URL = process.env.VNPAY_RETURN_URL || (process.env.FRONTEND_URL || 'https://frontend-datn-tau.vercel.app') + '/payment/return';

if (!VNPAY_HASH_SECRET) {
  throw new Error('VNPAY_HASH_SECRET is not configured. Set it in .env or environment variables.');
}

export interface VNPayPaymentInput {
  txnRef: string;
  amount: number; // VND
  orderInfo: string;
  ipAddr: string;
  locale?: 'vn' | 'en';
  bankCode?: string;
  orderType?: string;
}

export interface VNPayIPNResponse {
  isValid: boolean;
  txnRef: string | null;
  amount: number | null;
  transactionNo: string | null;
  responseCode: string | null;
  bankCode: string | null;
  payDate: string | null;
  message?: string;
}

/**
 * Format date thành yyyyMMddHHmmss theo giờ Việt Nam (UTC+7)
 */
function formatVnDate(date: Date): string {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnTime
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
}

/**
 * Build query string với keys & values đã URL-encode, sorted alphabetically
 * Dùng cho cả hash computation và URL
 */
function buildVnpayQueryString(params: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  const keys = Object.keys(params).sort();
  for (const key of keys) {
    sorted[key] = params[key];
  }
  return Object.entries(sorted)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * Tạo chữ ký HMAC-SHA256 theo chuẩn VNPAY
 *
 * Cách tính: sort params alphabetically → build query string với values URL-encoded → HMAC-SHA256
 */
function createSecureHash(params: Record<string, string>, secretKey: string): string {
  const encodedQuery = buildVnpayQueryString(params);
  return crypto
    .createHmac('sha256', secretKey)
    .update(encodedQuery)
    .digest('hex');
}

/**
 * Tạo URL thanh toán VNPAY
 */
export function createPaymentUrl(input: VNPayPaymentInput, customReturnUrl?: string): string {
  const { txnRef, amount, orderInfo, ipAddr, locale = 'vn', bankCode, orderType = 'other' } = input;

  const now = new Date();
  const createDate = formatVnDate(now);
  const expireDate = formatVnDate(new Date(now.getTime() + 60 * 60 * 1000));

  const returnUrl = customReturnUrl || VNPAY_RETURN_URL;

  const params: Record<string, string> = {
    vnp_Amount: String(amount * 100),
    vnp_Command: 'pay',
    vnp_CreateDate: createDate,
    vnp_CurrCode: 'VND',
    vnp_ExpireDate: expireDate,
    vnp_IpAddr: ipAddr,
    vnp_Locale: locale,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: orderType,
    vnp_ReturnUrl: returnUrl,
    vnp_TmnCode: VNPAY_TMN_CODE,
    vnp_TxnRef: txnRef,
    vnp_Version: '2.1.0',
  };

  if (bankCode) {
    params['vnp_BankCode'] = bankCode;
  }

  // Hash được tính trên encoded query string (cả key và value đều encode)
  const secureHash = createSecureHash(params, VNPAY_HASH_SECRET);

  // URL dùng query string giống hệt với hash computation
  const encodedQuery = buildVnpayQueryString(params);
  const paymentUrl = `${VNPAY_URL}?${encodedQuery}&vnp_SecureHash=${secureHash}`;

  return paymentUrl;
}

/**
 * Xác thực IPN callback từ VNPAY
 */
export function verifyIpnResponse(params: Record<string, string>): VNPayIPNResponse {
  try {
    const secureHash = params['vnp_SecureHash'];
    if (!secureHash) {
      return {
        isValid: false,
        txnRef: null,
        amount: null,
        transactionNo: null,
        responseCode: null,
        bankCode: null,
        payDate: null,
        message: 'Missing vnp_SecureHash',
      };
    }

    // Loại bỏ vnp_SecureHash khỏi params trước khi verify
    const { vnp_SecureHash, ...restParams } = params;

    // Hash cũng được tính trên encoded query string giống như lúc tạo URL
    const expectedHash = createSecureHash(restParams, VNPAY_HASH_SECRET);

    if (expectedHash !== secureHash) {
      return {
        isValid: false,
        txnRef: params['vnp_TxnRef'] || null,
        amount: params['vnp_Amount'] ? parseInt(params['vnp_Amount']) / 100 : null,
        transactionNo: params['vnp_TransactionNo'] || null,
        responseCode: params['vnp_ResponseCode'] || null,
        bankCode: params['vnp_BankCode'] || null,
        payDate: params['vnp_PayDate'] || null,
        message: 'Invalid checksum',
      };
    }

    return {
      isValid: true,
      txnRef: params['vnp_TxnRef'] || null,
      amount: params['vnp_Amount'] ? parseInt(params['vnp_Amount']) / 100 : null,
      transactionNo: params['vnp_TransactionNo'] || null,
      responseCode: params['vnp_ResponseCode'] || null,
      bankCode: params['vnp_BankCode'] || null,
      payDate: params['vnp_PayDate'] || null,
      message:
        params['vnp_ResponseCode'] === '00'
          ? 'Giao dịch thành công'
          : `Giao dịch thất bại (${params['vnp_ResponseCode']})`,
    };
  } catch (err: any) {
    return {
      isValid: false,
      txnRef: null,
      amount: null,
      transactionNo: null,
      responseCode: null,
      bankCode: null,
      payDate: null,
      message: err.message,
    };
  }
}

export function verifyReturnParams(params: Record<string, string>): VNPayIPNResponse {
  return verifyIpnResponse(params);
}

export function getReturnUrl(): string {
  return VNPAY_RETURN_URL;
}

export function getTmnCode(): string {
  return VNPAY_TMN_CODE;
}