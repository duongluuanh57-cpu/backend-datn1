import { z } from 'zod';

// Field dùng chung cho create + update. Zod strip key lạ và trim giúp controller
// không phải tự phòng thủ dữ liệu rác từ client.
const addressFields = {
  addressType: z.enum(['home', 'office'], { message: 'Loại địa chỉ không hợp lệ' }).optional(),
  fullName: z.string().trim().max(100, 'Họ tên tối đa 100 ký tự').optional(),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,20}$/, 'Số điện thoại không hợp lệ')
    .optional(),
  address: z.string().trim().max(200, 'Địa chỉ tối đa 200 ký tự').optional(),
  province: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  ward: z.string().trim().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
};

export const CreateAddressSchema = z.object(addressFields);

export const UpdateAddressSchema = z
  .object(addressFields)
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Không có trường nào được gửi để cập nhật',
  });

export type CreateAddressInput = z.infer<typeof CreateAddressSchema>;
export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>;
