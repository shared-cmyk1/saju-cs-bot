import { supabase } from '@/app/lib/supabase/client';
import type { AccountConfig } from '@/app/lib/types';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

let cachedAccounts: Map<string, AccountConfig> | null = null;
let cacheTimestamp = 0;

async function loadAccounts(): Promise<Map<string, AccountConfig>> {
  const now = Date.now();
  if (cachedAccounts && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedAccounts;
  }

  const { data, error } = await supabase
    .from('saju_cs_accounts')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('[AccountResolver] Failed to load accounts:', error);
    if (cachedAccounts) return cachedAccounts;
    return new Map();
  }

  const map = new Map<string, AccountConfig>();
  for (const row of data || []) {
    map.set(row.instagram_business_account_id, row as AccountConfig);
  }

  cachedAccounts = map;
  cacheTimestamp = now;
  return map;
}

export async function resolveAccountByInstagramId(
  businessAccountId: string
): Promise<AccountConfig | null> {
  const accounts = await loadAccounts();
  return accounts.get(businessAccountId) || null;
}

export async function resolveAccountById(
  accountId: string
): Promise<AccountConfig | null> {
  const accounts = await loadAccounts();
  for (const account of accounts.values()) {
    if (account.id === accountId) return account;
  }

  // 캐시에 없으면 DB 직접 조회
  const { data } = await supabase
    .from('saju_cs_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  return (data as AccountConfig) || null;
}

export function invalidateAccountCache(): void {
  cachedAccounts = null;
  cacheTimestamp = 0;
}
