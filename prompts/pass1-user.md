--- ACTIVE MEMORY ---
{{memory}}
--- END MEMORY ---

Analyze the email below and return a JSON object with exactly these fields:

{
  "category": "marketing | security_alert | account_notification | commerce | receipt | newsletter | subscription | human | other",
  "event_type": "short freeform label, e.g. shipment_update | payment_receipt | security_alert | subscription_renewal | refund_notice | marketing_email | account_change | human_message | other",
  "sender_type": "automated | marketing | human",
  "summary": "One sentence describing what this email is about",
  "likely_routine": true,
  "possible_action_required": false,
  "importance": 3,
  "reason": "Brief explanation of the importance score",
  "memory_ops": [
    {
      "op": "remember",
      "key": "unique-kebab-case-key",
      "type": "thread | pattern | expectation",
      "text": "What to remember for future runs — concise, one sentence",
      "ttl_days": 14
    }
  ]
}

Importance scale:
  1-2  Junk, marketing, or promotional content — birthday emails, sale announcements,
       concert/event recommendations, newsletters with no actionable content
  3-4  Routine transactional notifications — receipts, shipping updates, expected confirmations
  5-6  Worth knowing about, but no action needed
  7-8  Needs attention — failed payment, refund, dispute, unexpected account change
  9-10 Urgent — security breach, account locked, fraud, crisis

--- EMAIL ---
From: {{from}}
Subject: {{subject}}
Date: {{date}}

{{body}}
--- END EMAIL ---
