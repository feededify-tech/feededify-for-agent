# Prompt contract: what happens to a field prompt

How the Feededify generator uses a field prompt. Write prompts against this, not against guesses.

## Where prompts live

Admin → Optimized feed → **Products** → **Edit prompts** (Prompt Studio). Each row is one output field:

| Studio input | Meaning |
|---|---|
| Field name | Output key. Same name as a source attribute = **override** of that field; any other name = **new field**. Spaces become `_`. A `g:` prefix on a new field makes it `<g:name>` in XML feeds. |
| Type `text` | Generated from the prompt. |
| Type `google_product_category` | Classified automatically, no prompt. At most one per feed. |
| Prompt | Pasted verbatim into the generator's instructions. Max 20 000 characters. |

Feed-level settings (feed edit form) apply to every field:

- **Source attributes**: the product columns the model sees. Every field sees all of them.
- **Product link**: when set, facts scraped from the product page arrive as an extra column `page_facts`.
- **Language**: the output language for all fields (empty = the source data's language).

## What the model already receives

Do not repeat these rules in a field prompt; override them only on purpose.

- **Input:** a table of products, one row each, with every source attribute (and `page_facts` when present). Very long values are shortened before they reach the model.
- **Priority:** the field's prompt beats the general rules for that field (language, length, format, wording). Two rules always win: never invent information, and the output format.
- **Language:** from the feed setting. Identifiers (brands, model names, SKUs, GTINs, sizes, units) are never translated.
- **Data usage:** only facts in the product's own row. Brand, model, color, material, size, gender, age group, dimensions, specifications are never guessed. Deriving is allowed: "women's sneakers" supports gender = female; a color does not.
- **Ad policy:** unless the field asks, no prices, discounts, shipping, calls to action, store names, subjective claims ("best", "№1"), "!!!"/"★", or ALL CAPS (except brands, abbreviations, sizes).
- **Output:** a text field is a string. A field whose prompt asks for a list or structure (e.g. highlights) is a JSON array/object. An empty string `""` means "no value"; the source value then stays as it is.

## What a field prompt must add

In this order, one imperative per line:

1. **Goal**: what the field is for (who reads it, where it shows).
2. **Columns** by their exact source-attribute names, with priority.
3. **Structure / order** of the value.
4. **Hard limit**: characters, words or items. Nothing checks length after generation; the prompt is the only limit.
5. **Missing data**: return `""` or a stated fallback.
6. **Exceptions** to the general rules, only when the field needs them.
7. **1–2 format examples** with invented, generic products.

Example, new field:

```text
Short material label for catalog-ad overlays.
Use material; if empty, the material named in title or description.
Return the main material only, without percentages (e.g. "cotton", "genuine leather"). Keep codes and grades exactly as written (e.g. "DX51D").
At most 30 characters.
If no material is stated anywhere, return "".
```

Example, override of `title`:

```text
Rewrite the product title for Google Shopping.
Order: brand (if not empty), product type in plain words, key attribute (model, color or size from the data), gender if stated.
Use title and product_type; take brand from brand.
At most 150 characters; aim for 60-110.
Never start with the store name. Never add words that are not supported by the row.
If title is empty, return "".
Example: "Acme Trail 3 men's running shoes, black, 42".
```

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| `{{title}}`, `{brand}` | Nothing substitutes placeholders; the model sees the braces. Name the column in words. |
| "return null", "N/A" | The model writes that word into the feed as text, and it replaces the source value. Use `""`. |
| "Write in English" | The feed language already sets the output language. A prompt-level language wins for this field and silently diverges from the feed setting. Use it only when this one field must differ. |
| HTML or Markdown in the value | Feeds take plain text; ad platforms reject markup. |
| Columns that are not source attributes | The model never sees them. Add the column to the feed's source attributes first. |
| "Check the product page" | Only `page_facts` exist, and only when the feed has a product link. |
| No length limit | Nothing trims the value afterwards. |
| "If two values contradict, leave the fact out" | Misfires: the model dropped a product's own thickness because the description listed other products' sizes. Say instead: the title is the authority for this product's own values; text about other products is not a contradiction. |
| Format rule for one value shape only | Rules must cover every shape the data has: mixed units ("20×0,6 мм, 5 м"), threads ("M8×30", no unit), kits (use the main item's size). List each shape with an example. |
| Forced lowercase / uppercase | Breaks codes and grades (`dx51d` for `DX51D`). Say: keep codes and grades exactly as written. |
| Classifier field (`custom_label_N`) with ordered "first match" rules | The model ignores the order. Use one exclusive mapping table built from the feed's `product_type` values: each value maps to exactly one label. |
| Source text in another language than the feed (e.g. Russian text in a `uk` feed) | The text stays untranslated. Say: write in the feed language, translating the source. Naming the feed language is then correct; the lint warns only when the named language differs from the feed language (`--language`). |

## Consequences of saving

- **Cost:** any change to a prompt (or to the feed language) regenerates that field for **every** product on the next run.
- **Test vs run:** "Test draft prompts" in the studio uses one product at a time; the scheduled run processes many products together. Results are close, not identical. After the run, check the Products tab chips "changed" / "same as original" / "not generated".
