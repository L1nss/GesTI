export const DATA_RETENTION_MONTHS = 3;

export function retentionCutoff(now = new Date()) {
  const source = new Date(now);
  const firstOfTargetMonth = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() - DATA_RETENTION_MONTHS, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(source.getUTCDate(), lastDayOfTargetMonth));
  firstOfTargetMonth.setUTCHours(source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds());
  return firstOfTargetMonth.getTime();
}

function recordDate(record) {
  const value = record?.createdAt || record?.created_at || record?.date || record?.starts_at || record?.document_date || record?.month;
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function keepWithinRetention(records, now = new Date()) {
  if (!Array.isArray(records)) return [];
  const cutoff = retentionCutoff(now);
  return records.filter((record) => {
    const timestamp = recordDate(record);
    // Preserve legacy entries with no valid date rather than risk deleting them.
    return timestamp === null || timestamp >= cutoff;
  });
}
