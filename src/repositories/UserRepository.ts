import { User } from '../models/User.ts';
import type { IUser } from '../models/User.ts';

export class UserRepository {
  static async findByEmail(email: string): Promise<IUser | null> {
    return User.findOne({ email }).lean();
  }

  static async findByUsername(username: string): Promise<IUser | null> {
    return User.findOne({ username }).lean();
  }

  static async create(userData: Partial<IUser>): Promise<IUser> {
    const user = new User(userData);
    return user.save();
  }

  static async findByOAuthId(provider: string, oauthId: string): Promise<IUser | null> {
    return User.findOne({ oauthProvider: provider, oauthId }).lean();
  }

  static async findById(id: string): Promise<IUser | null> {
    return User.findById(id).lean();
  }

  static async update(id: string, data: Partial<IUser>): Promise<IUser | null> {
    return User.findByIdAndUpdate(id, data, { new: true });
  }

  static async findAll(): Promise<IUser[]> {
    return User.find({}).sort({ createdAt: -1 }).lean();
  }

  static async findPaginated(
    options: { page: number; limit: number; search?: string; role?: string }
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page, limit, search, role } = options;

    const query: any = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { username: { $regex: '^' + escaped, $options: 'i' } },
        { email: { $regex: '^' + escaped, $options: 'i' } },
      ];
    }

    if (role && role !== 'ALL') {
      if (role.includes(',')) {
        query.role = { $in: role.split(',') };
      } else {
        query.role = role;
      }
    }


    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const items = users.map((u: any) => {
      const { passwordHash, ...rest } = u;
      return rest;
    });

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async delete(id: string): Promise<boolean> {
    const result = await User.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }
}
