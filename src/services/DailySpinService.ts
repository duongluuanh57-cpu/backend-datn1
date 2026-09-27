import { DailySpin } from '../models/DailySpin.ts';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAILY_FREE_SPIN_HOUR = 6;

export interface DailySpinSnapshot {
  day: string;
  remaining: number;
  freeGranted: boolean;
  expiresAt: Date;
}

function getVietnamParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
  };
}

export function getVietnamDayKey(date = new Date()): string {
  const { year, month, day } = getVietnamParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getNextVietnamMidnight(date = new Date()): Date {
  const { year, month, day } = getVietnamParts(date);
  // Việt Nam hiện dùng UTC+7, không có DST. Mốc UTC tương ứng 00:00 ngày kế tiếp.
  return new Date(Date.UTC(year, month - 1, day + 1, -7, 0, 0));
}

function isDailyFreeSpinTime(date: Date): boolean {
  return getVietnamParts(date).hour >= DAILY_FREE_SPIN_HOUR;
}

function toSnapshot(row: any): DailySpinSnapshot {
  return {
    day: row.day,
    remaining: Math.max(0, Number(row.remaining) || 0),
    freeGranted: Boolean(row.freeGranted),
    expiresAt: row.expiresAt,
  };
}

export class DailySpinService {
  /**
   * Đảm bảo có balance của ngày hiện tại và cấp lượt miễn phí khi đã tới 06:00.
   * Việc này chạy theo request nên không phụ thuộc Render có thức lúc 00:00 hay không.
   */
  static async ensureToday(userId: string, now = new Date()): Promise<DailySpinSnapshot> {
    const day = getVietnamDayKey(now);
    const expiresAt = getNextVietnamMidnight(now);
    let current: any;

    try {
      current = await DailySpin.findOneAndUpdate(
        { userId, day },
        {
          $setOnInsert: {
            userId,
            day,
            remaining: 0,
            freeGranted: false,
          },
          $set: { expiresAt },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (error: any) {
      // Hai request đồng thời có thể cùng upsert; unique index userId+day
      // giữ tính idempotent, request thứ hai đọc lại document vừa tạo.
      if (error?.code !== 11000 && error?.code !== 11001) throw error;
      current = await DailySpin.findOne({ userId, day });
    }

    if (!current) throw new Error('Không thể tạo balance lượt quay hàng ngày');

    if (isDailyFreeSpinTime(now) && !current.freeGranted) {
      const granted = await DailySpin.findOneAndUpdate(
        { userId, day, freeGranted: false },
        { $set: { freeGranted: true }, $inc: { remaining: 1 } },
        { new: true },
      );

      if (granted) {
        current = granted;
      } else {
        current = await DailySpin.findOne({ userId, day });
      }
    }

    if (!current) throw new Error('Không thể tải balance lượt quay hàng ngày');
    return toSnapshot(current);
  }

  static async getRemaining(userId: string, now = new Date()): Promise<number> {
    const current = await this.ensureToday(userId, now);
    return current.remaining;
  }

  /** Consume một lượt của ngày hiện tại; trả về snapshot để có thể hoàn lượt khi xử lý lỗi. */
  static async consume(userId: string, now = new Date()): Promise<DailySpinSnapshot | null> {
    const current = await this.ensureToday(userId, now);
    const consumed = await DailySpin.findOneAndUpdate(
      { userId, day: current.day, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } },
      { new: true },
    );

    return consumed ? toSnapshot(consumed) : null;
  }

  /** Hoàn lại lượt khi tạo session/reward thất bại, chỉ hoàn trong đúng ngày đã consume. */
  static async restore(
    userId: string,
    day: string,
    amount = 1,
    now = new Date(),
  ): Promise<DailySpinSnapshot | null> {
    if (getVietnamDayKey(now) !== day || amount <= 0) return null;

    const restored = await DailySpin.findOneAndUpdate(
      { userId, day, remaining: { $gte: 0 } },
      { $inc: { remaining: amount } },
      { new: true },
    );
    return restored ? toSnapshot(restored) : null;
  }

  /** Cộng lượt thưởng một lần khi nâng hạng; lượt này cũng hết hạn cùng ngày. */
  static async addMembershipBonus(
    userId: string,
    amount: number,
    now = new Date(),
  ): Promise<DailySpinSnapshot> {
    const current = await this.ensureToday(userId, now);
    const updated = await DailySpin.findOneAndUpdate(
      { userId, day: current.day },
      {
        $inc: { remaining: Math.max(0, Math.floor(Number(amount) || 0)) },
        $set: { expiresAt: getNextVietnamMidnight(now) },
      },
      { new: true },
    );

    if (!updated) throw new Error('Không thể cộng lượt quay hạng thành viên');
    return toSnapshot(updated);
  }

  /** Hoàn lượt thưởng hạng khi ghi ledger thất bại. */
  static async removeMembershipBonus(
    userId: string,
    day: string,
    amount: number,
  ): Promise<DailySpinSnapshot | null> {
    const normalizedAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (normalizedAmount <= 0) return null;

    const updated = await DailySpin.findOneAndUpdate(
      { userId, day, remaining: { $gte: normalizedAmount } },
      { $inc: { remaining: -normalizedAmount } },
      { new: true },
    );
    return updated ? toSnapshot(updated) : null;
  }
}
