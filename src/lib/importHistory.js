'use strict';

// -----------------------------------------------------------------------------
// runPurge — delete import_history records beyond the user's retention limit.
//
// Safety guarantee: always keeps the most recent record per account so that
// the account_summary view's last_imported_at subquery is never affected.
// -----------------------------------------------------------------------------
async function runPurge(supabase, userId, limit) {
  const { data: allRecords } = await supabase
    .from('import_history')
    .select('id, account_id, imported_at')
    .eq('user_id', userId)
    .order('imported_at', { ascending: false });

  if (!allRecords || allRecords.length <= limit) return 0;

  // Keep: N most recent globally
  const keepIds = new Set(allRecords.slice(0, limit).map(r => r.id));

  // Keep: most recent per account (protects last_imported_at on dashboard)
  const seenAccounts = new Set();
  for (const r of allRecords) {
    if (r.account_id && !seenAccounts.has(r.account_id)) {
      keepIds.add(r.id);
      seenAccounts.add(r.account_id);
    }
  }

  const toDelete = allRecords.map(r => r.id).filter(id => !keepIds.has(id));
  if (toDelete.length === 0) return 0;

  const { error } = await supabase
    .from('import_history')
    .delete()
    .in('id', toDelete)
    .eq('user_id', userId); // belt-and-suspenders: never delete another user's records

  if (error) throw error;
  return toDelete.length;
}

module.exports = { runPurge };
