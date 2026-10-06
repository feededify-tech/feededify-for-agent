# Auto-tune: procedure detail

The loop in SKILL.md → "Mode: auto-tune", step by step. Tool names are the `feededify-admin` MCP
tools; your client may show them with a prefix (in Claude Code: `mcp__feededify-admin__optimized_feeds_get`).
`<skill-dir>` is this skill's folder. Every file goes to one temp folder for the session (for example
`<os temp>/feededify-autotune/<feed id>/`), never into a git repository.

## 1. Preflight (read only)

| Call | Keep |
|---|---|
| `optimized_feeds_get {optimized_feed_id}` | `name`, `total_offers`, `language`, `type`, `offer_element_name`, `offer_id_prop`, `csv_separator`, `source_attribute_names`, `source_feed_url`, `generated_feed_url`, `requires_auth`, `status`, `activated`, `optimized_field_prompts` (save it to `map-0.json`, the baseline map) |
| `optimized_feeds_history {optimized_feed_id}` | runs, newest first: `created_at`, `status`, `products_generated`, `batches_failed`, `cost_usd` |

- **Agreed fields** = the fields the user named. Every one must be `type: text` in the map or a new key.
  Never add a field on your own.
- **Cost estimate per iteration** = last full-run cost × (agreed fields ÷ text fields in the current map),
  rounded up to the cent. "Last full run" = the newest `completed` run with `products_generated` ≥
  `total_offers`; if none, the most expensive completed run in the history. With no completed run, say the
  cost is unknown. With no text field in the current map (division by 0), say "unknown, up to a full run
  (~$<last full-run cost>)". Total = estimate × 3. A run regenerates only fields whose prompt changed, so
  this is an upper-bound guess, not a quote.
- `status: process` means a run is in progress: wait for it (poll as in step 3e) before anything else.
- `activated: false`: each iteration uses `optimized_feeds_start` instead of `optimized_feeds_force_update`.
  Say so in the preflight message.

## 2. The one "yes"

Show exactly this, filled in, and wait:

```text
Auto-tune plan for feed "<name>" (<total_offers> products, language <language>):
- Fields to change: <field list>. All other fields keep their current prompts.
- Current prompts of these fields: <each field: prompt, or "new field">
- Up to 3 iterations. Each one saves the prompts and re-runs the feed (<force_update | start, the feed is inactive>).
- Estimated cost: ~$<estimate> per iteration, ~$<estimate × 3> at most.
- Your "yes" confirms every prompt save and feed run in this auto-tune session; I will not ask again for them.
Reply "yes" to start, anything else keeps manual mode.
```

Only an explicit yes ("yes", "так", "go") starts the loop. Anything else: hand off in manual mode and stop.

## 3. Baseline and iterations

**Data:** if `requires_auth` is false, check against the two public feeds:

```bash
node <skill-dir>/scripts/check-feed.mjs --generated <generated_feed_url> --source <source_feed_url> \
  --fields <agreed fields> --spec <tmp>/spec.json --language <language> --out <tmp>/iter-0 \
  --type <type> --item-path "<offer_element_name>" --id-prop <offer_id_prop> [--csv-separator "<csv_separator>"]
```

Add `--max-rows 2000` for feeds over ~5 000 products.

If `requires_auth` is true, the source feed cannot be downloaded. **Never page the whole feed through the
agent** (every page passes through your context). Use one fixed sample instead: call
`optimized_feeds_products {optimized_feed_id, skip: 0, count: 200}`, write the response to
`<tmp>/products-n.json` with your file tool, and pass `--products <tmp>/products-n.json` instead of
`--generated/--source`. Take the same `skip: 0, count: 200` rows in every iteration (baseline included), so the
iterations compare. Say in every report that the metrics cover a 200-row sample, not the whole feed.

**spec.json** comes from the prompts: `maxChars` / `minChars` from the stated limit, `allowed` for classifier
fields, `list {min, max, itemMax}` for list fields, `keepTitleNumbers: true` for fields that must carry the
title's sizes and grades (default on for title, short_title, size). For a classifier field whose label
depends on a source column, add `expect`: `{"from": "product_type", "leaf": true, "map": {"<last
product_type segment>": "<label>", ...}}`, built from the audit's classifier table (feed-prompt-audit
step 4) or from the prompt's own table. check-feed then counts `wrong_label` (output differs from the
mapped label) and `unmapped_label` (a source value missing from the map: extend the map, it is not a row
defect). Keep spec.json the same for every iteration so metrics compare.

**Version files.** `changes-n.json` holds only the agreed fields of version n:
`{"<field>": {"type": "text", "prompt": "..."}}`. `changes-0.json` is the baseline: the agreed fields as they
are in `map-0.json`, and `null` for an agreed field that did not exist yet (restoring the baseline removes it).

**Safe save** (every `set_prompts` call: the save of iteration n, and the best save below). The feed is
live and an admin may edit it meanwhile, so never save a map built from an old local copy. `<changes>` is
`changes-n.json` in an iteration and `changes-best.json` in the best save:

1. `optimized_feeds_get` right before the save; write its `optimized_field_prompts` to `<tmp>/fresh.json`.
   If an agreed field there differs from what you last saved (or from `map-0.json` before the first save),
   someone edited that field: stop and ask. Other fields may differ; they are kept as they are now.
2. `node <skill-dir>/scripts/prompt-map.mjs <tmp>/fresh.json <tmp>/<changes> --out <tmp>/save.json`.
   Check its summary: `changed` / `added` / `removed` name only agreed fields (`removed` only for an agreed
   field that is `null` in `<changes>`: it was new and its best version is the baseline). Anything else: stop.
3. `optimized_feeds_set_prompts {optimized_feed_id, specs: <save.json>}` → preview + `confirm_token`. Check
   the preview touches only agreed fields, then repeat the identical call with `confirm_token`. The token
   lives 5 minutes and is single use: if the review took longer, or the call rejects the token, repeat the
   preview call and confirm with the new token.

**Iteration n (1..3):**

a. **Draft / revise** the agreed fields only, from the previous iteration's `flagged.md` failures. Write
   `<tmp>/changes-n.json`. It holds every agreed field, also the ones you did not revise this time (copy
   their current version), so each version file is a complete set.
b. **Lint:** `node <skill-dir>/scripts/lint.mjs <tmp>/changes-n.json --columns <source_attribute_names> --language <language>`.
   Fix every error before saving.
c. **Save** with the safe save above.
d. **Run.** First call `optimized_feeds_history` and note the newest run's `created_at` (and its id, if the
   history has one): the **run baseline**, a server value. Then `optimized_feeds_force_update {optimized_feed_id}`
   → preview + token → repeat with the token (or `optimized_feeds_start` for an inactive feed).
e. **Poll:** `node <skill-dir>/scripts/wait-run.mjs 60`, then `optimized_feeds_history`; repeat until a run
   exists whose `created_at` is strictly later than the run baseline (compare the two server timestamps, never
   your own clock; with an empty baseline history, the first run) and whose `status` is final (`completed` or
   `failed`, anything not running). Give up after 20 polls (20 minutes): report the feed `status` from
   `optimized_feeds_get` and stop.
f. **Check:** run check-feed with `--out <tmp>/iter-n`. Read `flagged.md` (every flagged row), not only
   `sample.md` (the worst 15): counting real defects from the sample alone undercounts them. For each flagged
   row decide whether the flag is a real defect (a fact dropped or invented, a code recased, a wrong set value
   or label) or a false positive. Known false-positive shapes: a unit conversion (2,5 m → 2500 mm shows as
   num- 2.5 and num+ 2500); a model or article number that does not belong in `size`, including one glued to
   letters or a hyphen (ART9082, 9082-A); conventional `M8x30`; thousands separators (`1,500` reads as 1.5,
   `1 500` as 1 and 500); comma lists (`10,20,30` reads as 10.2 and 30). Count the real defect rows **per
   field**, and update the per-field best table below.
g. **Decide:** apply the stop rules below; stop early when no real blocking defect remains.

**Per-field best.** Keep a table: for each agreed field, `best[field]` = the version (0 = baseline) with the
fewest real defect rows for that field, and that count. After iteration n, a field's version n replaces
`best[field]` only if it has **at least 2 fewer** real defect rows than the current best. The margin is noise:
each version gets one run on a model with high run-to-run variance, so a 1-row difference is not evidence.
Fields are independent here: iteration 3 may be best for `custom_label_0` while iteration 2 stays best for
`title`.

**Best save** (a restore, or the end of the loop when the live prompts are not already the best set). Write
`<tmp>/changes-best.json` = for every agreed field, its prompt from `changes-<best[field]>.json` (a `null` from
`changes-0.json` stays `null`). Then do **one** safe save of `changes-best.json` as above: fetch a fresh map,
merge, check the preview names only agreed fields, confirm. Never save the agreed fields one by one, and
never save a map built from an earlier local copy.

After a best save without a run, the live feed is mixed: a field whose saved prompt did not change in this
save (its live output already came from its best version, so its prompt hash is unchanged) keeps its live
output; every field whose prompt changed holds output from a worse version until it regenerates on the next
run. Offer one `optimized_feeds_force_update` to regenerate those fields now, with its cost estimate
(the per-iteration estimate scaled to the number of changed fields), and run it only on the user's yes.

## 4. Stop rules

| Condition | Action |
|---|---|
| Run status not `completed`, or `batches_failed > 0` | Stop. Report the run. Do not save again. |
| Metrics worse than the previous iteration: more real defects on the agreed fields, or as many real defects and a higher total check count, or a fill rate down by more than 2 points | Best save (step 3): one safe save of `{field: best[field]}` for all agreed fields. No run unless the user asks (offer one force_update with its cost). Stop. |
| Third iteration done, or the estimate says the next run would pass the stated total (budget reached) | Stop. If any agreed field's live prompt is not its `best[field]` version, do the best save. |
| A save would change, add or remove a field outside the agreed list | Do not save. Stop and ask. |
| No real blocking defect left | Stop early (the live prompts are then the best set; no best save needed). |

The baseline (version 0) counts for "best": a field no iteration beats by the 2-row margin goes back to its
`changes-0.json` prompt (or is removed, when it was new).

## 5. Report

After each iteration, a short block:

```markdown
### Iteration <n>
- Prompt changes: <field>: <one line on what changed and why>
- Run: <created_at>, <products_generated> products, $<cost_usd> (<model>)

| field | fill% | <checks with any non-zero count> | real defects | best so far (version: defects) |
|---|---|---|---|---|
```

At the end: the final prompt of every agreed field **and the version (iteration) it came from**, total cost
from history, and what still fails (with counts, and generic examples only, no customer product text). With
`--products`, say the metrics cover the fixed 200-row sample. After a best save without a run, add:
"Saved prompts: <field> from iteration <n>, ...; fields <list> changed in this save and keep worse output in
the live feed until the next run (one force_update now costs ~$<estimate>)."
