---
name: optimized-field-prompt
description: Write, review and fix field prompts for a Feededify optimized feed (admin → Optimized feed → Products → Edit prompts) — new custom fields and overrides of existing fields such as title, description, custom_label_N, product_highlight, color, material. With the feededify-admin MCP and the admin's explicit yes, can also auto-tune: save the prompts, run the feed, measure the output and iterate (up to 3 runs). USE WHEN an admin asks to create, improve, review or debug an optimized-feed field prompt, or when generated feed values look wrong, or asks to auto-tune or test prompts on a feed. NOT FOR google_product_category (it is classified automatically, no prompt).
---

# Optimized-field prompt

Helps a Feededify admin produce field prompts. Two modes:

- **Manual (default):** the admin pastes the prompts into the admin's **Prompt Studio** themselves.
  You never touch the admin or any API: the admin brings the feed data, you write and check the
  prompt, the admin tests and saves it in the studio.
- **Auto-tune:** only when the `feededify-admin` MCP is connected **and** the user says "yes" to the
  plan. You save the prompts, run the feed and measure the result yourself. See
  [Mode: auto-tune](#mode-auto-tune-needs-the-feededify-admin-mcp) below.

If the user asks for auto-tune and the MCP tools (`optimized_feeds_get` and the rest) are not available,
say so and continue in manual mode.

Before drafting, read [references/prompt-contract.md](references/prompt-contract.md) (what the
generator already does, anti-patterns) and the field's section in
[references/field-recipes.md](references/field-recipes.md) (Google limits and templates).

## What to ask the admin for

Ask only for what is missing. All of it is visible in the admin:

| Need | Where the admin finds it |
|---|---|
| Field name and goal ("new `material_short`, ≤30 chars, for ad overlays") | their request |
| Source attributes (column names) | Optimized feed → edit form → Source attributes |
| Feed language, and whether a product link is set | same form |
| Current prompt, when fixing an existing field | Products → Edit prompts |
| 2–5 example products (source values, and current output when fixing) | Products tab, or the studio's "Context & prompt" tab |
| What is wrong, when fixing | their description or pasted bad outputs |

Treat pasted product data as working material only: do not save it to files outside a temp folder
and do not repeat customer names or shop domains back.

## Workflow

1. **Classify.** Field name equal to a source attribute → override; otherwise → new field. A
   `google_product_category` request → explain it needs no prompt (type `google_product_category`)
   and stop.
2. **Draft** using the anatomy below and the recipe. Name only columns that are in the source
   attributes. If a needed column is missing, say so: the admin must add it to Source attributes first.
   When fixing, start from the current prompt and keep what works.
3. **Self-test on the examples.** For each example product, write the value the prompt should produce
   and check it against the limit, the missing-data rule and "no invented facts". Fix the prompt
   until all examples pass.
4. **Lint** (Node 18+, no install):
   ```bash
   node <skill-dir>/scripts/lint.mjs draft.json --columns title,brand,description --language uk
   ```
   `--language` is the feed language; a prompt line naming that same language is then not warned about.
   `draft.json` is `{"<field>": {"type": "text", "prompt": "..."}}` (several fields allowed); write it
   to a temp folder. Errors must be fixed. Discuss each warning; keep one only on purpose (for example a
   per-field language that must differ from the feed). If Node is not available, apply the same checks
   by hand from the anti-pattern table.
5. **Hand off** in the format below, and ask the admin to run **Test draft prompts** in the studio on
   a few products and paste back anything that looks wrong. Iterate from step 2 with those results.

## Prompt anatomy

One imperative per line, in this order:

1. Goal of the field (who reads it, where it shows).
2. Columns by exact name, with priority.
2b. Source of truth: the title is the authority for this product's own values; text about other
   products is not a contradiction. Never "drop the fact if values conflict".
3. Structure / order of the value.
4. Hard limit in characters, words or items.
5. Missing data: return `""` or a stated fallback. Never "null" or "N/A".
6. Field-specific exceptions to the general rules, only if needed.
7. One or two format examples with invented generic products.

Do not restate what the generator already enforces (feed language, no invention, ad policy, output
format). Write the prompt in English or in the admin's language; the output language comes from the
feed setting either way.

## Hand-off format

````markdown
**Field name:** `<key>` · **Type:** text · (new field | override of source attribute `<key>`)

**Prompt** (paste into the studio's prompt box):
```text
<final prompt>
```

- Lint: OK (warnings kept on purpose: …)
- Checked against N example products: <one line on what they showed>
- Saving regenerates `<key>` for every product on the next run.
- Next: Products → Edit prompts → add/edit the field → **Test draft prompts** → Save.
````

## Mode: auto-tune (needs the feededify-admin MCP)

Use it when the user names an optimized feed, the fields to tune, and wants you to save and test the
prompts. It works on **that feed** (no copy) and changes only the fields the user named. Step-by-step
calls, file names and the report template: [references/auto-tune.md](references/auto-tune.md).

1. **Preflight, read only.** `optimized_feeds_get` (settings, current prompt map, `generated_feed_url`,
   `source_feed_url`, `activated`, `status`) and `optimized_feeds_history` (last run cost). Estimate the
   cost per iteration = last full-run cost × (fields to change ÷ text fields in the map), rounded up.
   Show: feed name, product count, fields to change, their current prompts, estimate × 3.
2. **Ask one explicit "yes"**, with the wording in the reference. It must say that this yes confirms
   every prompt save and feed run of this session: it is the human confirmation for the MCP two-phase
   calls (`optimized_feeds_set_prompts`, `optimized_feeds_force_update`), so you then pass their
   `confirm_token` yourself after checking each preview. No yes → manual-mode hand-off only, nothing saved.
3. **Baseline.** `check-feed.mjs` on the current generated feed for the agreed fields:
   ```bash
   node <skill-dir>/scripts/check-feed.mjs --generated <generated_feed_url> --source <source_feed_url> \
     --fields title,size --spec <tmp>/spec.json --language <feed language>
   ```
   Source feed behind auth: save `optimized_feeds_products` pages to a temp JSON and pass `--products`.
   stdout is a count table only; product rows go to `metrics.json` and `sample.md` in a temp folder.
4. **Iterate, at most 3 times:** draft or revise the prompts → `lint.mjs --language <feed language>` →
   **merge** into the current map with `scripts/prompt-map.mjs` → `optimized_feeds_set_prompts`
   (preview → confirm) → `optimized_feeds_force_update` (preview → confirm), or `optimized_feeds_start`
   if the feed is inactive → poll `optimized_feeds_history` after `node <skill-dir>/scripts/wait-run.mjs 60`
   until a completed run newer than the save (20 min timeout) → `check-feed.mjs` → read `sample.md` and
   judge which flags are real invented / dropped facts → stop early when no blocking issue remains.
5. **Stop rules:** a run failed or `batches_failed > 0`; metrics worse than the previous iteration
   (restore the best prompts with one more save, no run unless the user asks); budget spent; a save
   would touch any field outside the agreed list (never do that).
6. **Report** after each iteration: prompt diff summary, metrics table, cost from history. At the end:
   final prompts, total cost, what still fails.

**Merge rule.** `optimized_feeds_set_prompts` **replaces the whole map**: a saved map without an untouched
field deletes that field's prompt. Always save `mergeMap(current, changes)`: the current map with the
agreed fields replaced or added, every other key kept as is. A change of `null` removes a field; use it
only when the user asked to delete that field.
