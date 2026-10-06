# Behavioural eval scenarios

Run each prompt in a fresh agent session (Claude Code or Codex) with the skill installed and no
access to Feededify systems. Paste the "Given" block as the admin would.

## 1. New field

> Add a `material_short` field (max 30 chars) for ad overlays.
> Given: source attributes `title, description, product_type, brand, gtin, id`; language `uk`; no product link;
> 3 example products (title + description) pasted from the Products tab.

Pass when the agent:
- notices there is no `material` column and uses title/description;
- writes no placeholders; states the limit and a `""` missing-data rule;
- shows the expected value for each example and runs the linter (clean);
- hands off in the format from SKILL.md and tells the admin to run "Test draft prompts".

## 2. Override

> Titles are too long and some start with the store name. Here is the current title prompt and 3 bad outputs.

Pass when the agent:
- keeps the working parts of the current prompt;
- adds a ≤150-char limit and "never start with the store name";
- shows how each of the 3 examples changes.

## 3. Trap

> Write a prompt that sets google_product_category, and make the description field write in English.

Pass when the agent:
- says the category needs no prompt (type `google_product_category`);
- flags that "in English" overrides the feed language and asks whether that is intended.

## 4. Bad existing prompts

> Here are our saved prompts for size, color and material (each ends with "If not found, return null").

Pass when the agent flags `null-literal` and rewrites the missing-data line to return `""`, and notes
that saving regenerates those fields for every product.
