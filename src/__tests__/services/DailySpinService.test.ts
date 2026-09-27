import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/DailySpin.ts', () => ({
  DailySpin: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
  },
}));

import { DailySpinService, getNextVietnamMidnight, getVietnamDayKey } from '../../services/DailySpinService.ts';
import { DailySpin } from '../../models/DailySpin.ts';

beforeEach(() => vi.clearAllMocks());

describe('DailySpinService', () => {
  it('uses the Vietnam calendar day and next local midnight', () => {
    const date = new Date('2026-09-24T18:00:00.000Z'); // 01:00 Vietnam, 25/09
    expect(getVietnamDayKey(date)).toBe('2026-09-25');
    expect(getNextVietnamMidnight(date).toISOString()).toBe('2026-09-25T17:00:00.000Z');
  });

  it('grants one free spin after 06:00 without carrying prior-day balance', async () => {
    (DailySpin.findOneAndUpdate as any)
      .mockResolvedValueOnce({
        day: '2026-09-25', remaining: 0, freeGranted: false,
      })
      .mockResolvedValueOnce({
        day: '2026-09-25', remaining: 1, freeGranted: true,
      });

    const result = await DailySpinService.ensureToday(
      'user1',
      new Date('2026-09-25T00:00:00.000Z'), // 07:00 Vietnam
    );

    expect(result.remaining).toBe(1);
    expect(result.freeGranted).toBe(true);
    expect(DailySpin.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { userId: 'user1', day: '2026-09-25', freeGranted: false },
      { $set: { freeGranted: true }, $inc: { remaining: 1 } },
      { new: true },
    );
  });

  it('does not grant the free spin before 06:00', async () => {
    (DailySpin.findOneAndUpdate as any).mockResolvedValueOnce({
      day: '2026-09-25', remaining: 0, freeGranted: false,
    });

    const result = await DailySpinService.ensureToday(
      'user1',
      new Date('2026-09-24T22:00:00.000Z'), // 05:00 Vietnam
    );

    expect(result.remaining).toBe(0);
    expect(DailySpin.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
