---
name: optimized-field-prompt
description: Write, review and fix field prompts for a Feededify optimized feed (admin → Optimized feed → Products → Edit prompts) — new custom fields and overrides of existing fields such as title, description, custom_label_N, product_highlight, color, material. USE WHEN an admin asks to create, improve, review or debug an optimized-feed field prompt, or when generated feed values look wrong. NOT FOR google_product_category (it is classified automatically, no prompt).
---

# Optimized-field prompt

Helps a Feededify admin produce field prompts they paste into the admin's **Prompt Studio**
themselves. You never touch the admin or any API: the admin brings the feed data, you write and
check the prompt, the admin tests and saves it in the studio.

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
   node <skill-dir>/scripts/lint.mjs draft.json --columns title,brand,description
   ```
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
