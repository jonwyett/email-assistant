These {{count}} emails are all from {{group_name}}:

{{emails}}

Return a JSON object with exactly these fields:

{
  "group_name": "short vendor or sender name",
  "group_summary": "One or two sentences summarizing what this group of emails is about as a whole",
  "routine_count": 3,
  "notable_items": ["specific item that needs attention or is unusual — empty array if nothing notable"],
  "aggregate_facts": ["3 receipts totaling $47", "1 package in transit — empty array if nothing useful to aggregate"],
  "include_in_digest": true
}

Rules:
- notable_items: only items that are genuinely unusual, require action, or represent a problem. Use an empty array if everything is routine.
- aggregate_facts: concise factual summaries (counts, totals, dates, statuses). Use an empty array if nothing useful.
- include_in_digest: false if the entire group is marketing, promotional, or advertising content.
  This includes: sale emails, birthday promotions, event/concert recommendations, newsletters.
  Only set to true if the group contains transactional, account, or security content.
- Return valid JSON only.
