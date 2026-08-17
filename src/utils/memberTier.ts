export type MemberTier = 'MEMBER' | 'Bac' | 'Vang' | 'KimCuong';

export const MEMBER_TIER_THRESHOLDS: Record<Exclude<MemberTier, 'MEMBER'>, number> = {
  Bac: 10_000_000,
  Vang: 20_000_000,
  KimCuong: 30_000_000,
};

export function computeMemberTier(totalSpent: number): MemberTier {
  if (totalSpent >= MEMBER_TIER_THRESHOLDS.KimCuong) return 'KimCuong';
  if (totalSpent >= MEMBER_TIER_THRESHOLDS.Vang) return 'Vang';
  if (totalSpent >= MEMBER_TIER_THRESHOLDS.Bac) return 'Bac';
  return 'MEMBER';
}

export function memberTierRange(tier: string): { min: number; max?: number } | null {
  switch (tier) {
    case 'Bac':
      return { min: MEMBER_TIER_THRESHOLDS.Bac, max: MEMBER_TIER_THRESHOLDS.Vang };
    case 'Vang':
      return { min: MEMBER_TIER_THRESHOLDS.Vang, max: MEMBER_TIER_THRESHOLDS.KimCuong };
    case 'KimCuong':
      return { min: MEMBER_TIER_THRESHOLDS.KimCuong };
    case 'MEMBER':
      return { min: 0, max: MEMBER_TIER_THRESHOLDS.Bac };
    default:
      return null;
  }
}
