# Feededify skills

Agent skills for Feededify admins, packaged as the Claude Code plugin **`feededify`**. Each folder in
`skills/` is a self-contained [Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
(`SKILL.md` + references + scripts) that also works in Codex and claude.ai.

Українська інструкція для адмінів: [README.uk.md](README.uk.md).

| Skill | What it does |
|---|---|
| [`optimized-field-prompt`](skills/optimized-field-prompt/SKILL.md) | Writes, reviews and fixes field prompts for an optimized feed (admin → Optimized feed → Products → Edit prompts): new custom fields and overrides of title, description, color, size, custom labels, highlights and more. You paste the result into Prompt Studio, test it there and save. The agent never connects to Feededify itself. |

## Install

### Claude Code (recommended)

Run inside Claude Code, then restart it:

```text
/plugin marketplace add feededify-tech/feededify-skills
/plugin install feededify@feededify-skills
```

If the first command fails with an SSH error, use the full URL:
`/plugin marketplace add https://github.com/feededify-tech/feededify-skills.git`.

- **Check:** ask "which feededify skills do you have?" The answer includes `feededify:optimized-field-prompt`.
- **Auto-update:** `/plugin` → **Marketplaces** → `feededify-skills` → **Enable auto-update**.
  Manual update: `/plugin marketplace update feededify-skills`. New skills arrive with updates.

### Codex and other agents

Get the repo (**Code → Download ZIP** on GitHub, or `git clone https://github.com/feededify-tech/feededify-skills.git`)
and copy `skills/optimized-field-prompt` into your agent's skills folder:

| Agent | Skills folder |
|---|---|
| Codex | `~/.agents/skills/` (older versions: `~/.codex/skills/`) |
| Claude Code without the plugin | `~/.claude/skills/` |

### claude.ai

Zip the `skills/optimized-field-prompt` folder and upload it in Settings → Customize → Skills.

### Optional: Node 18+

The skill lints prompts with `scripts/lint.mjs`. Without Node the agent applies the same checks by hand.

## How to use `optimized-field-prompt`

### 1. Give the agent the feed context

Ask in plain words and include what you see in the admin:

| What | Where in the admin |
|---|---|
| Field name and goal ("new `material_short`, max 30 chars, for ad overlays") | your request |
| Source attributes (column names) | Optimized feed → edit form → Source attributes |
| Feed language, and whether a product link is set | same form |
| 3–5 example products, **from different categories** | Products tab, or the studio's "Context & prompt" tab |
| When fixing a field: its current prompt and a few bad outputs | Products → Edit prompts, Products tab |

The agent asks for anything that is missing.

### 2. Get the prompt

The agent drafts the prompt, checks it against your examples, lints it and hands back:

```text
Field name: material_short · Type: text · new field
Prompt: <text to paste>
Lint: OK · Checked against 4 example products · Saving regenerates material_short for every product.
```

### 3. Test and save in Prompt Studio

1. Products → **Edit prompts** → add the field (or open the existing one) → paste the prompt.
2. **Test draft prompts** on 3–5 products, ideally ones that were not in your examples.
3. Paste anything wrong back to the agent; it revises the prompt.
4. **Save.** Saving regenerates that field for **every** product on the next run.

### Example requests

- **New field:** "Add `material_short`: the main material, max 30 characters, shown on catalog-ad images.
  Source attributes: title, description, product_type, brand. Language uk. Products: 1) … 2) … 3) …"
- **Better titles:** "Our titles are too long and some start with the store name. Current title prompt: … Bad outputs: …"
- **Highlights:** "Add `product_highlight`: 3–6 short facts per product for Google Shopping."
- **Campaign labels:** "Add `custom_label_0` to split campaigns by product group: yoga, fitness equipment, balls, accessories, other."
- **Fix a field:** "Our size values are wrong for some products. Current size prompt: … Outputs: …"
- **Review:** "Review all our saved prompts: …" (catches `null` answers, missing limits, placeholders)
- **Category:** "Set up google_product_category". The agent explains it needs no prompt (type `google_product_category`).

### Rules of thumb

- Missing data is `""`. Never "return null" or "N/A": the word ends up in the feed.
- Name columns exactly as in Source attributes; there are no `{{placeholders}}`.
- State a hard limit (characters or items) for every field.
- The output language comes from the feed setting. If your source data is in another language
  (for example Russian text in a `uk` feed), say so: the prompt then tells the model to translate.
- Give examples from different categories, so rules work for the whole catalog, not only for the examples.

## Linter

```bash
node skills/optimized-field-prompt/scripts/lint.mjs draft.json --columns title,brand,description
node --test skills/optimized-field-prompt/scripts/
```

`draft.json` is the field map: `{"material_short": {"type": "text", "prompt": "..."}}`.

## License

MIT, see [LICENSE](LICENSE).
