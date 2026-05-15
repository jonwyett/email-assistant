Today is {{date}}. {{total}} emails have been analyzed.

Analyzed emails (sorted by importance, highest first):

{{emails}}

Return a JSON digest with exactly this structure:

{
  "needs_attention": [
    "Specific description of what needs action and why"
  ],
  "worth_noting": [
    "Brief note about something worth knowing"
  ],
  "activity_summary": [
    "Aggregated routine activity, e.g. '3 security notifications from Google'"
  ],
  "suppressed": {
    "marketing": 0,
    "newsletters": 0,
    "other_routine": 0
  }
}
