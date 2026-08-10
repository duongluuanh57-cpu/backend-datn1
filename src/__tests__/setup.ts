// Setup file for backend tests
// Load environment variables from .env for testing
import * as dotenv from "dotenv";
dotenv.config();

// Set test defaults if .env not loaded
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-for-unit-tests";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret-key";
process.env.JWT_ISSUER = "saas-core-backend";
process.env.JWT_AUDIENCE = "saas-core-client";
process.env.VNPAY_TMN_CODE = "TESTCODE";
process.env.VNPAY_HASH_SECRET = "TESTHASHSECRET";
process.env.VNPAY_URL = process.env.VNPAY_URL || "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
process.env.VNPAY_RETURN_URL = process.env.VNPAY_RETURN_URL || "http://localhost:3000/payment/return";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-for-unit-tests";
process.env.R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN || "https://pub-test.r2.dev";
process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "lessence-testq9";
