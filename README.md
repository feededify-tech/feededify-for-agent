# Feededify skills

Agent skills for Feededify admins. Each folder in `skills/` is a self-contained
[Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) (`SKILL.md` +
references + optional scripts) that works in Claude Code, Codex and claude.ai. In Claude Code the repo installs as the plugin `feededify`.

| Skill | What it does |
|---|---|
| [`optimized-field-prompt`](skills/optimized-field-prompt/SKILL.md) | Writes, reviews and fixes field prompts for an optimized feed (admin → Optimized feed → Products → Edit prompts): new custom fields and overrides of title, description, custom labels, highlights and more. You paste the result into Prompt Studio and test it there. |

## Install

### Claude Code (recommended)

Run these two commands inside Claude Code:

```text
/plugin marketplace add feededify-tech/feededify-skills
/plugin install feededify@feededify-skills
```

Restart Claude Code. The skill appears as `feededify:optimized-field-prompt`; new skills added to this
repo arrive with plugin updates. To get updates automatically: `/plugin` → **Marketplaces** →
`feededify-skills` → **Enable auto-update**. Manual update: `/plugin marketplace update feededify-skills`.

### Codex and other agents

Copy (or link) `skills/optimized-field-prompt` into your agent's skills folder:

| Agent | Skills folder |
|---|---|
| Codex | `~/.agents/skills/` (older versions: `~/.codex/skills/`) |
| Claude Code without the plugin | `~/.claude/skills/` |

Get the folder with **Code → Download ZIP** on GitHub, or `git clone https://github.com/feededify-tech/feededify-skills.git`.

### claude.ai

Zip the `skills/optimized-field-prompt` folder and upload it in Settings → Customize → Skills.

## Use

Ask your agent in plain words, for example:

- "Add a `material_short` field, max 30 characters, for ad overlays. Source attributes: title, description, brand. Language uk. Here are 3 products: …"
- "Titles in this feed are too long. Here is the current title prompt and 3 bad outputs: …"
- "Review these saved prompts: …"

The agent asks for anything missing (source attributes, language, example products), writes the
prompt, checks it on your examples, lints it, and hands it back for you to paste into Prompt Studio
and run **Test draft prompts**. It never connects to Feededify itself.

The linter needs only Node 18+:

```bash
node skills/optimized-field-prompt/scripts/lint.mjs draft.json --columns title,brand,description
node --test skills/optimized-field-prompt/scripts/
```

## License

MIT, see [LICENSE](LICENSE).
