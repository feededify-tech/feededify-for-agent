---
name: feed-prompt-audit
description: Audit a Feededify optimized feed from its source products and recommend which fields to optimize, with feed-specific risks and draft field prompts. Profiles the source feed (fill, language mix, constant brand, other-products sections in descriptions, dimension notation, mixed units, title/description conflicts, product_type distribution, variant groups), lints the existing prompts, and proposes prompts plus a product_type → label table for classifier fields. Works with the feededify-admin MCP or with a source URL from the admin. USE WHEN an admin asks to audit or analyze an optimized feed, which fields to optimize or add, what is wrong with a feed's prompts, or to propose prompts from the feed's products. NOT FOR saving prompts or running the feed (that is optimized-field-prompt auto-tune), or for writing a single prompt the admin already specified (use optimized-field-prompt).
---

# Feed prompt audit

Looks at what a feed's products actually contain and tells the admin which optimized fields are worth
adding or fixing, what each prompt must handle for **this** feed, and drafts the prompts. It never saves
anything: the hand-off is either manual (admin pastes into Prompt Studio) or the `optimized-field-prompt`
auto-tune mode, which asks its own "yes".

**Needs both skills.** The scripts live in the `optimized-field-prompt` skill folder
(`../optimized-field-prompt/scripts/` from this file), and the drafts follow its anatomy and recipes.
The `feededify` plugin installs both. In a manual install, copy both folders side by side.

Read before recommending:
- [references/profile-signals.md](references/profile-signals.md): what each profile signal means for each field prompt.
- `../optimized-field-prompt/references/prompt-contract.md` and `field-recipes.md`: anatomy, limits, anti-patterns.

## 1. Feed settings

**With the `feededify-admin` MCP:** `optimized_feeds_get {optimized_feed_id}`. Keep `name`, `language`,
`type`, `offer_element_name`, `offer_id_prop`, `csv_separator`, `source_feed_url`, `requires_auth`,
`source_attribute_names`, `optimized_field_prompts`, `total_offers`.

**Without the MCP** (say that it is not connected, then continue): ask the admin for the source feed URL
(or a downloaded file), its format if not RSS/Atom XML (CSV and separator), the source attributes, the
feed language, and the current prompts if any. All are on the optimized feed's edit form and in
Products → Edit prompts.

## 2. Profile the source feed

```bash
node <dir>/../optimized-field-prompt/scripts/profile-feed.mjs <source_feed_url> \
  --columns <source_attribute_names> --language <language> \
  --type <type> --item-path "<offer_element_name>" --id-prop <offer_id_prop> [--csv-separator "<csv_separator>"]
```

`<dir>` is this skill's folder. Columns named differently from `title` / `description` / `product_type` /
`brand`: pass `--title-col`, `--description-col`, `--type-col`, `--brand-col`.

**Source needs auth** (`requires_auth: true`, or the download fails with 401/403): with the MCP, page
`optimized_feeds_products {optimized_feed_id, skip, count: 1000}` (up to ~3 000 rows is enough), write the
responses as a JSON array to a temp file and run `profile-feed.mjs --products <file> --columns ...`.
Without the MCP, ask the admin for an export file.

Outputs go to a temp folder (`<os temp>/feededify-profile-feed/<timestamp>/`):
- stdout: counts only. Safe to quote in chat.
- `profile.json`: signals, counts, example ids, the full `product_type` distribution.
- `sample.md`: 2 rows per product_type (≤30, rows with signals first), values cut to 600 characters.
  Read it to confirm signals; it is customer product data: do not paste it into chat, do not copy it
  into a repository.

The script handles large feeds (one pass; 17k items in seconds). Never read the whole feed into the chat.

## 3. Lint the existing prompts

If the feed has prompts, write `optimized_field_prompts` to a temp `current.json` and run:

```bash
node <dir>/../optimized-field-prompt/scripts/lint.mjs current.json --columns <source_attribute_names> --language <language>
```

Then compare each prompt to the profile: does it cover the shapes and risks the profile found
(other-products text, mixed units, threads, Russian source, constant brand, forced case, ordered rules
in classifier fields)? A gap is a finding even when lint passes.

## 4. Recommend

Pick fields by value for Google Shopping and by what the data supports. Typical candidates: `title`
(almost always), `product_highlight`, `product_type` cleanup, `size`, `material`, `color`,
`custom_label_N` for campaign split, `short_title`. Skip a field when the data has nothing for it
(say so: "no color in any column"). Recommend adding a column to Source attributes when the profile
shows it in `all_columns` and a field needs it. `google_product_category` needs no prompt.

For every recommended field, draft the prompt with the `optimized-field-prompt` anatomy and recipe, and
encode the lessons that apply to this feed:

- Source of truth: the title is the authority for this product's own values; text about other products
  is not a contradiction. Never "drop the fact if values conflict".
- Format rules cover every value shape the profile found (mixed units, threads, kits, tuples with and
  without units), one invented example each.
- Never force case; keep codes and grades exactly as written.
- Classifier fields: one exclusive `product_type → label` table built from `product_type.values`, plus a
  fallback label. No ordered rules.
- Source language differs from the feed language: "Write in <feed language>, translating the source text."

Lint every draft (`lint.mjs drafts.json --columns ... --language <language>`) and fix errors before
showing it.

## 5. Output

Reply in the admin's language. Use counts and generic descriptions; no customer product titles, shop
names or domains.

```markdown
## Feed facts
| Fact | Value |
|---|---|
| Products | <rows> (<source format>, language <language>) |
| Columns used | <source attributes, fill %> |
| Brand | <"constant: store/maker name, not a product brand" or "N distinct"> |
| Language of the source | <uk N, ru N, ...> |
| Other-products sections | <N rows, M name sizes> |
| Sizes | <separators used; shapes: threads N, tuples N, mixed units N> |
| Title/description conflicts | <N (thickness N, dimensions N)>; example ids: … |
| Categories | <N product_type values, breadcrumbs "<sep>"> |
| Variant groups | <N groups, largest N> |
| Existing prompts | <fields; lint result; gaps found> |

## Field recommendations
| Field | Why | Data available | Risks to handle |
|---|---|---|---|
| title | … | title 100%, description 100% | constant brand; mixed units; other-products text |

## Draft prompts
<per field: the optimized-field-prompt hand-off block (field name, type, prompt, lint result)>

## Classifier table (for custom_label_N)
| product_type | count | label |
|---|---|---|

## Next step
```

Last section, **Next step**: offer two paths for the fields the admin picks.
1. Manual: paste each prompt into Products → Edit prompts → **Test draft prompts** → Save.
2. Auto-tune (only with the `feededify-admin` MCP): "Shall I auto-tune `<fields>` on this feed?". If
   the admin agrees, switch to the `optimized-field-prompt` skill, mode auto-tune, with these drafts as
   iteration 1. That mode shows its cost estimate and asks its own explicit "yes" before saving or
   running anything; this audit never saves prompts or runs the feed.
