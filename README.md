# Feededify skills

Agent skills for Feededify admins. Each folder in `skills/` is a self-contained
[Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) (`SKILL.md` +
references + optional scripts) that works in Claude Code, Codex and claude.ai.

| Skill | What it does |
|---|---|
| [`optimized-field-prompt`](skills/optimized-field-prompt/SKILL.md) | Writes, reviews and fixes field prompts for an optimized feed (admin → Optimized feed → Products → Edit prompts): new custom fields and overrides of title, description, custom labels, highlights and more. You paste the result into Prompt Studio and test it there. |

## Install

Clone once, then link (or copy) the skill folder where your agent looks for skills.

```bash
git clone https://github.com/feededify-tech/feededify-skills.git
```

| Agent | Skills folder |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.agents/skills/` (older Codex versions: `~/.codex/skills/`) |
| claude.ai | Settings → Capabilities → Skills → upload a zip of the skill folder |

macOS / Linux:

```bash
ln -s "$PWD/feededify-skills/skills/optimized-field-prompt" ~/.claude/skills/optimized-field-prompt
```

Windows (PowerShell, no admin rights needed):

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\optimized-field-prompt" -Target "$PWD\feededify-skills\skills\optimized-field-prompt"
```

Update later with `git pull` in the clone; linked skills update with it.

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
