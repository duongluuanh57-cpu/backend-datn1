import { z } from 'zod';

export const RegisterSchema = z.object({
  username: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(
      z.string()
        .min(3, 'Username phải dài hơn 3 ký tự')
        .max(50)
        .regex(/^[a-z0-9._-]+$/, 'Username chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang')
    ),
  email: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().email('Email không hợp lệ')),
  password: z
    .string()
    .min(8, 'Mật khẩu phải dài ít nhất 8 ký tự')
    .regex(/[a-zA-Z]/, 'Mật khẩu phải chứa ít nhất một chữ cái')
    .regex(/[0-9]/, 'Mật khẩu phải chứa ít nhất một chữ số'),
  turnstileToken: z.string().optional(),
});

export const LoginSchema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email hoặc tên đăng nhập'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
  turnstileToken: z.string().optional(),
});

// Policy thống nhất với đăng ký: tối thiểu 8 ký tự, phải có chữ và số
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại').optional(),
  newPassword: z
    .string()
    .min(8, 'Mật khẩu phải dài ít nhất 8 ký tự')
    .regex(/[a-zA-Z]/, 'Mật khẩu phải chứa ít nhất một chữ cái')
    .regex(/[0-9]/, 'Mật khẩu phải chứa ít nhất một chữ số'),
});

export const CreateAdminSchema = z.object({
  username: z.string().trim().min(3, 'Username phải dài hơn 3 ký tự').max(50),
  email: z.string().trim().email('Email không hợp lệ'),
  password: z
    .string()
    .min(8, 'Mật khẩu phải dài ít nhất 8 ký tự')
    .regex(/[a-zA-Z]/, 'Mật khẩu phải chứa ít nhất một chữ cái')
    .regex(/[0-9]/, 'Mật khẩu phải chứa ít nhất một chữ số'),
  fullName: z.string().trim().max(100).optional(),
});

export const UpdateUserSchema = z
  .object({
    role: z.enum(['USER', 'ADMIN'], { message: 'Vai trò không hợp lệ' }).optional(),
    status: z.enum(['active', 'suspended'], { message: 'Trạng thái không hợp lệ' }).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'Không có trường nào được gửi để cập nhật',
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateAdminInput = z.infer<typeof CreateAdminSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export type UserRole = 'USER' | 'ADMIN';
export type MemberTier = 'MEMBER' | 'Bac' | 'Vang' | 'KimCuong';
export type UserAccountStatus = 'active' | 'suspended';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export interface UserRoleLite {
  id?: string;
  _id?: string;
  username?: string;
  email?: string;
  role?: UserRole;
  memberTier?: MemberTier;
  totalSpent?: number;
  rewardPoints?: number;
  membershipRewardedTier?: MemberTier;
  status?: UserAccountStatus;
  fullName?: string;
  phoneNumber?: string;
  gender?: Gender;
  dateOfBirth?: string;
  avatar?: string;
  oauthProvider?: 'google';
  oauthId?: string;
  lastLoginAt?: string;
  hasPassword?: boolean;
  defaultAddress?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
