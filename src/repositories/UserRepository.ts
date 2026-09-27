import { User } from '../models/User.ts';
import type { IUser } from '../models/User.ts';
import { memberTierRange } from '../utils/memberTier.ts';

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

  static async findByIdWithSecurity(id: string): Promise<IUser | null> {
    // Hiện tại không còn field select:false liên quan đến bảo mật.
    return User.findById(id).lean();
  }

  static async update(id: string, data: Partial<IUser>): Promise<IUser | null> {
    return User.findByIdAndUpdate(id, data, { new: true });
  }

  static async findPaginated(
    options: { page: number; limit: number; search?: string; role?: string; status?: string; memberTier?: string; sortBy?: string }
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page, limit, search, role, status, memberTier, sortBy } = options;

    const match: any = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      match.$or = [
        { username: { $regex: '^' + escaped, $options: 'i' } },
        { email: { $regex: '^' + escaped, $options: 'i' } },
      ];
    }

    if (role) match.role = role;

    if (status) {
      match.status = status;
    }

    const tierRange = memberTier ? memberTierRange(memberTier) : null;
    const needsSpent = Boolean(tierRange) || sortBy === 'spentDesc' || sortBy === 'spentAsc';

    // Pipeline lọc chung (kể cả lọc theo hạng thành viên tính real-time từ tổng chi tiêu)
    const filteredPipeline: any[] = [{ $match: match }];

    if (needsSpent) {
      filteredPipeline.push({
        $lookup: {
          from: 'orders',
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$userId', '$$uid'] }, { $eq: ['$status', 'delivered'] }],
                },
              },
            },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } },
          ],
          as: 'spent',
        },
      });
      filteredPipeline.push({
        $addFields: {
          totalSpent: { $ifNull: [{ $arrayElemAt: ['$spent.total', 0] }, 0] },
        },
      });
    }

    if (tierRange) {
      const rangeExpr =
        tierRange.max !== undefined
          ? { $and: [{ $gte: ['$totalSpent', tierRange.min] }, { $lt: ['$totalSpent', tierRange.max] }] }
          : { $gte: ['$totalSpent', tierRange.min] };
      filteredPipeline.push({ $match: { $expr: rangeExpr } });
    }

    let sortStage: any = { createdAt: -1 };
    switch (sortBy) {
      case 'oldest':
        sortStage = { createdAt: 1 };
        break;
      case 'nameAsc':
        sortStage = { username: 1 };
        break;
      case 'nameDesc':
        sortStage = { username: -1 };
        break;
      case 'spentDesc':
        sortStage = { totalSpent: -1, createdAt: -1 };
        break;
      case 'spentAsc':
        sortStage = { totalSpent: 1, createdAt: -1 };
        break;
      default:
        sortStage = { createdAt: -1 };
    }

    const countResult = await User.aggregate([...filteredPipeline, { $count: 'total' }]);
    const total = countResult[0]?.total || 0;

    const users = await User.aggregate([
      ...filteredPipeline,
      { $sort: sortStage },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { passwordHash: 0, spent: 0, __v: 0 } },
    ]);

    return { items: users, total, page, totalPages: Math.ceil(total / limit) };
  }
}
