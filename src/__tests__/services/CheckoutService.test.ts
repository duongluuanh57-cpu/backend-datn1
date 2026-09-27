import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import mongoose, { MongooseError } from 'mongoose';

// ---------------------------------------------------------------------------
// Mock external modules that CheckoutService depends on. Mocks are defined
// before importing the service so that the service receives the mocked
// implementations.
// ---------------------------------------------------------------------------
// Define a placeholder for the default address that will be populated in the
// test's `beforeAll`. The mock returns an object with a `lean` method that
// resolves to this placeholder, allowing the service to receive the expected
// shape.
let mockDefaultAddress: any = {
  _id: new mongoose.Types.ObjectId(),
  userId: 'user-123',
  fullName: 'Nguyen Van A',
  phoneNumber: '0901234567',
  email: 'a@example.com',
  address: 'CD. Hoang Dieu, Q. Thanh Xuan, Ha Noi',
  ward: 'Hoa Binh',
  district: 'Thanh Xuan',
  city: 'Ha Noi',
  province: 'Ha Noi',
  isDefault: true,
};vi.mock('../../models/UserAddress.ts', () => ({
    UserAddress: {
      findOne: vi.fn().mockReturnValue({
        lean: () => Promise.resolve(mockDefaultAddress),
      }),        find: vi.fn().mockReturnValue({
          lean: () => Promise.resolve([mockDefaultAddress]),
        }),
    },
  }));

vi.mock('../../models/PaymentMethod.ts', () => ({
  PaymentMethod: {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'paymentMethodId', code: 'cod' }),
      }),
    }),
  },
}));

vi.mock('../../models/User.ts', () => ({
  User: {
    findById: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: () => Promise.resolve({ email: 'a@example.com', memberTier: 'MEMBER' }),
      }),
    }),
  },
}));

vi.mock('../../services/VoucherService.ts', () => ({
  VoucherService: {
    validate: vi.fn(),
    incrementUsage: vi.fn(),
  },
}));

vi.mock('../../utils/helpers.ts', () => ({
  calculateShippingFee: vi.fn().mockResolvedValue({ fee: 0, shippingFee: 0 }),
}));

vi.mock('../../controllers/order/orderHelpers.ts', () => ({
  markSoldCounted: vi.fn(),
   adjustTotalSold: vi.fn(),
}));

vi.mock('../../services/FlashSaleService.ts', () => ({
  FlashSaleService: {
    recordFlashSalePurchases: vi.fn(),
  },
}));

// StockService.deductStock is called inside processCheckout. For the unit test we
// want it to succeed without touching the database, so we mock it to return an
// empty array (no failures).
vi.mock('../../services/cart/StockService.ts', () => ({
  StockService: {
    deductStock: vi.fn().mockResolvedValue([]),
    restoreOrderResources: vi.fn(),
  },
}));

// Import after mocks are set up.
import { CheckoutService } from '../../services/cart/CheckoutService.ts';
import { UserAddress } from '../../models/UserAddress.ts';
import { User } from '../../models/User.ts';
import { Order } from '../../models/Order.ts';
import { VoucherService } from '../../services/VoucherService.ts';
import { PaymentMethod } from '../../models/PaymentMethod.ts';

/**
 * Test that CheckoutService.processCheckout builds the shippingInfo object
 * from the user's default address (instead of relying on client‑provided data).
 */
describe('CheckoutService.processCheckout – shippingInfo generation', () => {
  const mockUserId = '6589abcd1234567890abcdef';

  const defaultAddress = {
    _id: 'addrId',
    userId: mockUserId,
    isDefault: true,
    fullName: 'Nguyễn Văn A',
    email: 'a@example.com',
    phoneNumber: '0912345678',
    address: '123 Đường ABC',
    ward: 'Phường Bến Nghé',
    district: 'Quận 1',
    province: 'TP.HCM',
  } as any;

  const payload = {
    // Provide required shipping fields for CheckoutService.
    // This test expects shippingInfo to be built from payload values.
    customerName: defaultAddress.fullName,
    customerEmail: defaultAddress.email,
    customerPhone: defaultAddress.phoneNumber,
    customerAddress: defaultAddress.address,

    paymentMethod: 'cod',
    shippingMethod: 'standard' as const,
    // Provide a dummy item to trigger the buy‑now flow.
    items: [{ productId: '6589abcd1234567890abcdef', quantity: 1 }],

    userId: mockUserId,
  } as any;

  beforeAll(() => {
    // Assign the placeholder used by the UserAddress mock.
    mockDefaultAddress = defaultAddress;
    // Stub resolveBuyNowItems so the service can continue without real DB.
    vi.spyOn(CheckoutService as any, 'resolveBuyNowItems').mockResolvedValue({ resolvedItems: [], totalAmount: 0 });
    // Voucher validation – no voucher applied.
    (VoucherService.validate as any).mockResolvedValue({ valid: false } as any);
    // Capture the payload passed to Order.create – only for the first call.
    vi.spyOn(Order as any, 'create').mockImplementationOnce(async (obj: any) => ({ _id: 'orderId', ...obj } as any));
  });

  beforeEach(() => {
    // PaymentMethod.findOne mock - prevent database calls via timeout
    (PaymentMethod.findOne as any).mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve({ _id: 'pmId', code: 'cod' })
      })
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('populates shippingInfo from the default UserAddress', async () => {
    const result: any = await CheckoutService.processCheckout(mockUserId, payload);

    // The first argument of Order.create contains the shippingInfo.
    const createdPayload = (Order.create as any).mock.calls[0][0] as any;
    expect(createdPayload.shippingInfo).toBeDefined();
    expect(createdPayload.shippingInfo.customerName).toBe(defaultAddress.fullName);
    expect(createdPayload.shippingInfo.customerEmail).toBe(defaultAddress.email);
    expect(createdPayload.shippingInfo.customerPhone).toBe(defaultAddress.phoneNumber);
    expect(createdPayload.shippingInfo.customerAddress).toBe(
      `${defaultAddress.address}, ${defaultAddress.ward}, ${defaultAddress.district}, ${defaultAddress.province}`
    );
    // Note: CheckoutService currently sets only the base fields
    // (customerName/customerEmail/customerPhone/customerAddress).

    // The service does not return shippingInfo directly; verification is done via
    // the payload passed to Order.create above.
  });
});
