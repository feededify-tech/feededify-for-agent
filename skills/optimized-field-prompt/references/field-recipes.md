# Field recipes

Limits from the Google Merchant Center product data specification,
https://support.google.com/merchants/answer/7052112 (retrieved 2026-10-06). Re-check when a limit matters.

Each recipe: limit → structure → missing data → prompt template. Templates are starting points;
adapt column names to the feed's `source_attribute_names`.

## title

Max 150 characters, plain text.
Structure: brand → product type → key attributes (model, color, size, material) → gender/age if stated.
Missing data: if `title` is empty return `""`.

```text
Rewrite the title for Shopping ads: brand, product type in plain words, then the most distinctive attributes from the data.
At most 150 characters; aim for 60-110. Front-load the words a shopper searches for.
Never start with the store name; never add attributes the row does not state.
If title is empty, return "".
```

## short_title

Max 150 characters, recommended 5-65.

```text
Short title for mobile and catalog ads: product type and the single most distinctive attribute; brand only if it fits.
At most 65 characters. If title is empty, return "".
```

## description

Max 5000 characters, plain text.

```text
Product description for Shopping ads, 2-4 short paragraphs, plain text, no lists or markup.
First sentence: what the product is and for whom. Then materials, features and use, only from the data.
At most 1000 characters. If description and title are both empty, return "".
```

## product_highlight

2 to 100 highlights, max 150 characters each. Ask for a JSON array; the generator keeps it as a JSON list.

```text
Return a JSON array of 3-6 product highlights, each a short phrase of at most 150 characters, no trailing period.
Each highlight states one concrete fact from the data (material, feature, fit, care). No marketing claims.
If fewer than 2 facts are available, return "".
```

## product_detail

Up to 100 details; `section_name` and `attribute_name` max 140 characters, `attribute_value` max 1000.
Ask for a JSON array of objects.

```text
Return a JSON array of objects {"section_name": ..., "attribute_name": ..., "attribute_value": ...} with the technical specifications stated in the data (e.g. section "General", attribute "Material", value "Cotton").
Only attributes the row states; at most 20 objects. If none, return "".
```

## custom_label_0 … custom_label_4

Max 100 characters each. Used for campaign segmentation, not shown to shoppers. Values must come from a
small fixed set, or bidding cannot group them.

```text
Classify the product into exactly one label using the table below; every product_type value maps to exactly one label, there is no "first match" order.
Return the label only, at most 100 characters. If product_type is empty or not in the table, return "other".
product_type | label
Running shoes | running
Hiking boots | outdoor
Sneakers | casual
```

Build the table from the feed's actual `product_type` values (ask the admin for the distinct list). Do not
write ordered "first match" rules: the model ignores the order.

## color

Max 100 characters; max 40 per color; several colors separated by `/`.

```text
The product color as a shopper would name it, e.g. "black" or "black/white" (main color first, at most 3).
Use color; if empty, a color named in title. At most 100 characters. If no color is stated, return "".
```

## material

Max 200 characters.

```text
The main material(s), e.g. "cotton" or "leather/rubber". Use material, then title and description.
Keep codes and grades exactly as written (e.g. "DX51D", "AISI 304"); never change their case.
At most 200 characters. If no material is stated, return "".
```

## size

Max 100 characters. Keep the source notation exactly (`XL`, `42`, `10.5 US`).

```text
The size exactly as written in the data. Never convert between size systems. If no size is stated, return "".
```

Cover every value shape the feed has, with one example each:

- Mixed units: write each dimension with its own unit, e.g. "20×0,6 мм, 5 м".
- Threads: "M8×30", no unit added.
- Kits: use the size of the main item.
- The title is the authority for this product's own values. Text about other products (a description listing other sizes) is not a contradiction; do not drop the product's own value because of it.

## gender

Allowed values only: `male`, `female`, `unisex`.

```text
Return exactly one of: male, female, unisex. Derive only from explicit words in title, product_type or description ("men's", "for women").
If the data does not state it, return "".
```

## age_group

Allowed values only: `newborn`, `infant`, `toddler`, `kids`, `adult`.

```text
Return exactly one of: newborn, infant, toddler, kids, adult. Use "adult" only if the data clearly targets adults.
If the data does not state it, return "".
```

## New free-form field

Pick a key that says what the value is (`material_short`, `ad_headline`). Prefix `g:` only when the
consumer expects a Google-namespace tag. State: purpose, source columns, format, limit, missing-data rule.
