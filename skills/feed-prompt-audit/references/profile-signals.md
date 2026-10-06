# Profile signals → what each prompt must handle

`profile-feed.mjs` writes `profile.json`; this table says what each signal means for the field prompts.
Signals are heuristics: confirm a signal on the rows in `sample.md` (or the example ids in `profile.json`)
before you write a rule for it. A count of 0 means: do not add a rule for it.

Prompt rules below use the anatomy from `optimized-field-prompt` (goal → columns → source of truth →
structure → limit → missing data → exceptions → examples). Format examples in prompts use invented,
generic products, never rows from the feed.

## Columns

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `columns.<c>.fill_rate` < 1 | Some rows have no value | Missing-data line names the fallback column, or `""`. A field whose main column is mostly empty is a weak candidate: say so. |
| `columns.<c>.len.p95` | Typical upper length | Sets the limit. `title` p95 under ~40 chars: the title is thin, an override that adds type and attributes has value. `description` p50 under ~100: little material for highlights or details. |
| `all_columns` has columns not in `source_attribute_names` | Data the model does not see | Recommend adding them to Source attributes first (e.g. `material`, `color`, `size` columns). Only with a profile of the source feed itself: on the `--products` path `all_columns` holds just the attributes already selected, so this cannot fire. |
| `constant_columns` | One value in every row | That column carries no product information. Never use it as a fact source. |

## Brand

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `brand.constant: true` (≥95% one value) | One name for the whole catalog: either the store or a shop that makes everything it sells | **Ask the admin whether this is the store or the real maker** before any rule. Store: `title` never starts with it, and a `brand` override only when real brands appear in title/description. Real maker: the value is correct; `title` may keep it, at the end. |
| `brand.distinct` high, `top_share` low | Real per-product brands | Normal recipes apply. |

## Language

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `language.ru_rows` > 0 with feed language `uk` | Russian source text (ы э ё ъ, or Russian-only endings / words such as "профильная", "и", "из") | Every text field: "Write in Ukrainian, translating the source text." Naming the feed language here is correct; `lint --language uk` does not warn about it. The stage test without this line left 3–4 of 6 titles in Russian. |
| `columns.<c>.latin` dominant, feed language not English | Source in another language | Same rule with that pair of languages. |
| `language.unmarked_share.<c>` high (over ~30%) | Many values are Cyrillic with no uk/ru marker; short Russian titles can hide here | Read the titles in `sample.md`. If any are Russian, add the translate line above even when `ru_rows` is 0. |

## Description content

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `other_products.rows` > 0, especially `with_numbers` | Descriptions list other products, often other sizes ("Інший прокат…:", "Є також моделі", "також може зацікавити", "Що ще купують", "Супутні товари") | Source-of-truth line in **every** field that reads description: "The title is the authority for this product's own values. Text in the description about other products is not this product and is not a contradiction; ignore it." Never "drop the fact if values conflict": that rule made the model drop the product's own thickness. `product_highlight` / `product_detail`: "Use only the part of the description about this product." |
| `min_order.rows` | "Мінімальний обсяг замовлення" lines | Not a product attribute: `title`, `short_title`, highlights must leave it out. `description` override may keep it only if the admin wants it. |
| `approx_values.rows` | "типово Z140", "приблизно" | Highlights / details: keep the qualifier ("typically Z140"); never state a typical value as a guaranteed one. |
| `html.<c>` > 0 | Markup tags | `description` override and anything reading description: "Plain text; drop markup." |
| `entities.<c>` > 0 | `&nbsp;`, `&gt;` left as text (CDATA) | The model sees them as characters. Text fields: "Plain text; replace `&nbsp;` with a space." For `product_type`, `&gt;` is just the breadcrumb separator; no prompt rule needed. |

## Sizes and dimensions

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `dimensions.<c>.separators` uses more than one of `×` / `x` / `х`, or `feed_separators` ≥ 2 | Inconsistent notation | `title` / `size`: "Write dimensions with ×, numbers as written: 1000×2000." State it for every shape below. |
| `dimensions.title_shapes.thread` | Threads (M8, M8x30) | "Threads as written in the title (M8×30), no unit added." |
| `dims_with_unit`, `dims_no_unit` | Tuples with and without a unit | One example each. Never add a unit the source does not give. |
| `single_with_unit` | Thickness / length on its own ("0,5 мм") | Keep it; it is often the variant key. |
| `kit` | "пара", "комплект", "N шт" | `size`: use the main item's size; `title`: keep the kit word. |
| `mixed_units.rows` | Several length units in one title ("20 мм, товщина 0,6 мм, довжина 5 м") | "Write each dimension with its own unit, e.g. 20×0,6 мм, 5 м. Never put one unit on numbers that had different units." The stage test collapsed this to "20×5 м". |
| `conflicts.rows` (`thickness`, `dimensions`) | **Possible** source-data conflicts: the title and the description's own text seem to give different numbers. Heuristic: units, packaging and lengths vs thicknesses are not normalised | Confirm on the example ids in `sample.md` / `profile.json` before telling the admin. Confirmed ones are source-data errors worth fixing in the shop; the prompt's source-of-truth line (title wins) covers them. For a `size` field, add a test example where the description disagrees. |

## Codes and case

The profile does not count codes; check `sample.md` titles for grades and articles (DX51D, AISI 304,
Z140, ART 9082). If present: "Keep codes and grades exactly as written; never change their case." Never
ask for lowercase or uppercase output (the stage test produced `dx51d` in 37 of 132 rows).

## product_type and classifier fields

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `product_type.values` | Every category with its count and leaf | Classifier fields (`custom_label_N`) get **one exclusive table**: each value → exactly one label, no ordered "first match" rules (the model ignored the order: 11% wrong). Use the leaf in the table when leaves are unique; the full path otherwise. Add the fallback: "If product_type is not in the table, return "other"." |
| `product_type.separator`, `common_prefix` | Breadcrumbs such as "Головна > Каталог > …" | The prefix carries nothing; a `product_type` override (when asked) drops `common_prefix` and keeps the rest. |
| `product_type.distinct` > ~40 | Too many values for one prompt table | Map the second level of the breadcrumb, or ask the admin for the grouping. |
| `product_type.empty_rows` | Rows without a category | The classifier needs the fallback label; mention the count. |

## Variants

| Signal | Meaning | Prompt consequence |
|---|---|---|
| `variant_groups.groups`, `largest` | Titles that differ only by size / color | `title`: the distinguishing size or color must stay in the value (otherwise variants become duplicate titles). `custom_label_N` by size range can be useful for large groups. |
