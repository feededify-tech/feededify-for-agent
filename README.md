# Feededify skills

Agent skills for Feededify admins, packaged as the Claude Code plugin **`feededify`**. Each folder in
`skills/` is a self-contained [Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
(`SKILL.md` + references + scripts) that also works in Codex and claude.ai.

Українська інструкція для адмінів: [README.uk.md](README.uk.md).

| Skill | What it does |
|---|---|
| [`feed-prompt-audit`](skills/feed-prompt-audit/SKILL.md) | Audits an optimized feed from its source products: profiles the data (fill, language mix, constant brand, sizes and units, categories), lints the existing prompts, and tells you which fields are worth optimizing, with the risks to handle and draft prompts. It never saves anything. |
| [`optimized-field-prompt`](skills/optimized-field-prompt/SKILL.md) | Writes, reviews and fixes field prompts for an optimized feed (admin → Optimized feed → Products → Edit prompts): new custom fields and overrides of title, description, color, size, custom labels, highlights and more. By default you paste the result into Prompt Studio, test it there and save. With the admin MCP connected it can also **auto-tune** (see below). |

The two skills work together: the audit uses the other skill's scripts and prompt rules.

## Connect the Feededify admin MCP

The plugin ships a `.mcp.json` that registers the `feededify-admin` MCP server
(`https://mcp.feededify.app/mcp`). It is installed together with the plugin.

- **First use:** Claude Code opens a browser; sign in with your Feededify admin account (OAuth). If it does
  not start by itself, run `/mcp` and authenticate `feededify-admin`.
- **Without the MCP,** both skills still work in manual mode: you give the agent a source feed URL (or an
  export file) and paste the prompts into Prompt Studio yourself. Auto-tune needs the MCP.
- **Codex and other agents:** add the MCP server by hand with the URL `https://mcp.feededify.app/mcp`
  (HTTP transport) in your agent's MCP settings.

## Install

### Claude Code (recommended)

Run inside Claude Code, then restart it:

```text
/plugin marketplace add feededify-tech/feededify-skills
/plugin install feededify@feededify-skills
```

If the first command fails with an SSH error, use the full URL:
`/plugin marketplace add https://github.com/feededify-tech/feededify-skills.git`.

- **Check:** ask "which feededify skills do you have?" The answer includes `feededify:optimized-field-prompt`
  and `feededify:feed-prompt-audit`.
- **Auto-update:** `/plugin` → **Marketplaces** → `feededify-skills` → **Enable auto-update**.
  Manual update: `/plugin marketplace update feededify-skills`. New skills arrive with updates.

### Codex and other agents

Get the repo (**Code → Download ZIP** on GitHub, or `git clone https://github.com/feededify-tech/feededify-skills.git`)
and copy **both** folders, `skills/optimized-field-prompt` and `skills/feed-prompt-audit`, into your agent's
skills folder, side by side (the audit uses the other skill's scripts):

| Agent | Skills folder |
|---|---|
| Codex | `~/.agents/skills/` (older versions: `~/.codex/skills/`) |
| Claude Code without the plugin | `~/.claude/skills/` |

### claude.ai

Zip each of the two skill folders and upload them in Settings → Customize → Skills. Without the admin MCP the
skills run in manual mode.

### Optional: Node 18+

The skills lint prompts and profile feeds with scripts in `skills/optimized-field-prompt/scripts/`.
Without Node the agent applies the same checks by hand.

## Audit a feed

Use this first when you do not know which fields to optimize. The agent reads the feed settings (with the
MCP) or asks you for the source feed URL, profiles the source products, lints the current prompts and
replies with: feed facts, a table of recommended fields (why, data available, risks), draft prompts, and a
`product_type` → label table for classifier fields such as `custom_label_N`. It saves nothing. It ends
with two next steps: paste the prompts into Prompt Studio yourself, or auto-tune them.

Customer product data stays out of the chat: the agent reports counts and generic descriptions, and keeps
samples in a temp folder.

## Auto-tune

Needs the admin MCP. The agent tunes prompts **on the feed you name** by measuring real output:

1. Reads the feed, its run history and the current prompts (read only).
2. Shows a plan: the fields it will change, their current prompts, up to 3 iterations, and a cost
   estimate (based on the feed's last full run).
3. You answer **yes**. That one yes covers every prompt save and feed run in this session, up to
   **3 iterations**. Anything else keeps manual mode.
4. Each iteration: drafts or revises the prompts, lints them, saves them, runs the feed, waits for the run,
   then checks the generated values against the source (limits, allowed values, facts dropped or invented)
   and reads the flagged rows.
5. Stops when no real defect is left, after iteration 3, or when a run fails.

Safety:
- Only the fields you named are changed. All other prompts are kept exactly as they are, and the agent
  stops and asks if someone edits one of your fields meanwhile.
- Saving regenerates the edited fields **for every product** in the feed. Cost is shown first; the real
  cost per run is reported from the run history.
- If an iteration gets worse than the previous one, the agent **restores the best version** (the original
  prompts included) and stops. Restoring changes the saved prompts only: the generated feed keeps the
  worse output until the next run, and the agent says so.
- The final report lists each field's final prompt, its iteration, the total cost and what still fails.

## How to use `optimized-field-prompt` (manual mode)

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

- **Audit:** "Audit optimized feed `<id>` and tell me which fields to optimize."
- **Auto-tune:** "Auto-tune title and size on feed `<id>`."
- **Manual prompt:** "Write a material prompt for these products: 1) … 2) … 3) …"
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
