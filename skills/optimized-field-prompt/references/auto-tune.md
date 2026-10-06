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

If `requires_auth` is true, page `optimized_feeds_products {skip, count: 1000}` until `total`, write the pages to
`<tmp>/products.json` (an array of the responses) and pass `--products <tmp>/products.json` instead of
`--generated/--source`. Add `--max-rows 2000` for feeds over ~5 000 products.

**spec.json** comes from the prompts: `maxChars` / `minChars` from the stated limit, `allowed` for classifier
fields, `list {min, max, itemMax}` for list fields, `keepTitleNumbers: true` for fields that must carry the
title's sizes and grades (default on for title, short_title, size). Keep it the same for every iteration
so metrics compare.

**Version files.** `changes-n.json` holds only the agreed fields of version n:
`{"<field>": {"type": "text", "prompt": "..."}}`. `changes-0.json` is the baseline: the agreed fields as they
are in `map-0.json`, and `null` for an agreed field that did not exist yet (restoring the baseline removes it).

**Safe save** (every `set_prompts` call, in an iteration and in a restore). The feed is live and an admin
may edit it meanwhile, so never save a map built from an old local copy:

1. `optimized_feeds_get` right before the save; write its `optimized_field_prompts` to `<tmp>/fresh.json`.
   If an agreed field there differs from what you last saved (or from `map-0.json` before the first save),
   someone edited that field: stop and ask. Other fields may differ; they are kept as they are now.
2. `node <skill-dir>/scripts/prompt-map.mjs <tmp>/fresh.json <tmp>/changes-n.json --out <tmp>/save.json`.
   Check its summary: `changed` / `added` / `removed` name only agreed fields (`removed` only when version n
   is the baseline without a new field). Anything else: stop.
3. `optimized_feeds_set_prompts {optimized_feed_id, specs: <save.json>}` → preview + `confirm_token`. Check
   the preview touches only agreed fields, then repeat the identical call with `confirm_token`. The token
   lives 5 minutes and is single use: if the review took longer, or the call rejects the token, repeat the
   preview call and confirm with the new token.

**Iteration n (1..3):**

a. **Draft / revise** the agreed fields only, from the previous sample.md failures. Write `<tmp>/changes-n.json`.
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
f. **Check:** run check-feed with `--out <tmp>/iter-n`. Read `sample.md` yourself: for each listed row decide
   whether the flag is a real defect (a fact dropped or invented, a code recased, wrong set value) or a false
   positive. Known false-positive shapes: a unit conversion (2,5 m → 2500 mm shows as num- 2.5 and num+ 2500);
   a model or article number that does not belong in `size`, including one glued to letters or a hyphen
   (ART9082, 9082-A); conventional `M8x30`; thousands separators (`1,500` reads as 1.5, `1 500` as 1 and 500);
   comma lists (`10,20,30` reads as 10.2 and 30). Count the real defects.
g. **Decide:** apply the stop rules below; stop early when no real blocking defect remains.

## 4. Stop rules

| Condition | Action |
|---|---|
| Run status not `completed`, or `batches_failed > 0` | Stop. Report the run. Do not save again. |
| Metrics worse than the previous iteration: more real defects on the agreed fields, or as many real defects and a higher total check count, or a fill rate down by more than 2 points | Restore the best version (fewest real defects so far, baseline included): one safe save of that version's `changes-n.json`, merged into a freshly fetched map. No run unless the user asks. Stop. |
| Third iteration done, or the estimate says the next run would pass the stated total | Stop with the best map in place (restore it as above if the last one is not the best). |
| A save would change, add or remove a field outside the agreed list | Do not save. Stop and ask. |
| No real blocking defect left | Stop early. |

The baseline (iteration 0) counts as an iteration for "best": if no iteration beats it, restore
`changes-0.json`.

A restore without a run changes only the saved prompts: the generated feed keeps the worse output until the
next scheduled run, or a run the user asks for. Say so in the report.

## 5. Report

After each iteration, a short block:

```markdown
### Iteration <n>
- Prompt changes: <field>: <one line on what changed and why>
- Run: <created_at>, <products_generated> products, $<cost_usd> (<model>)

| field | fill% | <checks with any non-zero count> | real defects |
|---|---|---|---|
```

At the end: the final prompt of every agreed field, the iteration it came from, total cost from history,
and what still fails (with counts, and generic examples only, no customer product text). After a restore
without a run, add: "Saved prompts are restored to iteration <n>; the live feed still holds the iteration
<m> output until the next run."
