# How Email Watchdog Works

## The Big Picture

Email Watchdog is not an AI chatbot that reads your inbox and tells you what's important. It's a traditional software program — one that follows a clear, predictable set of steps every time it runs — that brings in an AI at specific moments to do the things software is bad at: reading comprehension, judgment, and pattern recognition.

Think of it like a well-run newsroom. Reporters (software) gather the raw material, editors (AI) decide what's worth publishing, and a layout team (software again) assembles the final product. The AI doesn't run the show — it fills the roles that require genuine understanding.

---

## What It Does

When you run it, the program works through your Gmail inbox and produces a short digest of anything that actually matters — a plain-text summary delivered to your email. Most inboxes are 90% noise: receipts, newsletters, marketing, automated notifications. The goal is to find the 10% that isn't, and surface only that.

It only ever processes emails it hasn't seen before. Run it daily, weekly, or whenever you feel like it — it picks up where it left off.

---

## The Passes

The program works in a series of distinct passes. Each pass has a focused job, and the AI is only called in when human-like judgment is actually needed.

### Pass 1 — Reading Each Email

The program feeds each new email to the AI one at a time and asks a structured set of questions: What is this about? Who sent it? Does it require action? How important is it on a scale of 1 to 10?

The AI returns a structured answer — not a freeform response, but a precise set of fields the program can work with. The program then applies its own rules on top: an email only makes it into the digest if it scores above a certain importance threshold or flags as requiring action. That decision is made by code, not the AI.

### Pass 2 — Grouping Related Emails

Before building the digest, the program groups emails by sender and type. If you received five emails from Amazon this week, they become one group — not five separate entries. For groups with multiple emails, the AI reads them together and produces a single aggregated summary ("3 orders placed, 1 package in transit"). For a group with only one email, the program handles this itself without calling the AI at all.

### Pass 3 — Writing the Digest

The program assembles the groups and passes them to the AI with a simple instruction: organize these into a digest with sections for things that need attention, things worth knowing, and routine activity. Pure marketing is excluded before the AI even sees it — the program filters that out itself, so it can never accidentally end up in your digest regardless of how the AI might have categorized it.

### Pass 4 — Reflection

After the digest is sent, the program asks the AI to update a small file called `brain.md` — a compact summary of what it has learned about your inbox over time: which senders are routine, which patterns are normal, what to watch out for. This file is read at the start of every future analysis run, so the AI's understanding of your inbox deepens with each use.

---

## Memory and Learning

Two mechanisms allow the system to build up knowledge over time.

**Short-term memory** is written by the AI during Pass 1. If an email mentions a package that's in transit, the AI can make a note of it — something like "Amazon package expected Friday." That note is stored in the database and injected into future analysis runs. When the delivery confirmation arrives a few days later, the AI already knows to expect it. Notes expire automatically after a set number of days.

**Long-term knowledge** lives in `brain.md`. After each run, the AI reads the digest it just produced and updates this file to reflect what it learned — refining its understanding of your senders and patterns. Unlike short-term memory, this knowledge doesn't expire. It accumulates over time.

Crucially, the AI writes both of these itself. You don't have to train it or configure it. It develops its own working knowledge of your inbox through use.

---

## Your Preferences

There is also a file called `user-prefs.md` that you can edit directly, in plain English. It lets you give the system hard rules: "never surface Spotify marketing emails," "always flag anything from my bank." These rules are injected directly into the AI's instructions and treated as non-negotiable — they override whatever the AI might otherwise decide.

---

## Why This Approach

Sending your entire inbox to an AI and asking "what's important?" has a fundamental problem: the AI has no context, no memory, and no consistent framework. It will give you a different answer every time, and it has no way to learn that you find Uber receipts uninteresting.

Email Watchdog uses the AI surgically — for reading comprehension and summarization — while keeping control of the logic, the rules, and the workflow in traditional code. The result is a system that is predictable, auditable, and gets better the more you use it.
