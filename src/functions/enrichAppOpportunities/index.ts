import { enrichOpportunityRecords } from "@libs/appOpportunities";

export const handler = async (event: { records?: unknown[] }) => {
  const result = await enrichOpportunityRecords(event?.records || []);
  console.log(`[enrichAppOpportunities] enriched ${result.enriched} records.`);
  return result;
};
