# SkillMD

[SkillMD](https://skillmd.com) is an open registry of `SKILL.md` agent skills. Its
read API and its MCP server do not ask for an account. This app uses the
public documents, not a guessed address:

- MCP server card: `https://skillmd.com/.well-known/mcp/server-card.json`
- MCP URL from that card: `https://api.skillmd.com/mcp` (streamable HTTP, auth `none`)
- OpenAPI: `https://skillmd.com/openapi.json`
- Read API: `https://api.skillmd.com`

There is no client id and no client secret.

## What you can add

**Plugins → SkillMD → Add** saves that MCP server with no token. It stays off
until its tools load, then it is turned on. **Disconnect** turns it off. It
does not sign out, because there is no account.

**Browse SkillMD** searches `GET /v1/search` and, when you turn the filter
off with an empty search, lists `GET /v1/skills`. The registry currently
ignores `verified_only`, so this app keeps **Reviewed only** on by itself and
keeps items whose `verified` field is `true`. About 1,947 of about 1.13
million skills are reviewed. Turning the filter off shows the rest and marks
each one that is not verified with **Unreviewed**. A skill whose review
status cannot be confirmed is treated as unreviewed.

**Reviewed picks** is a short list confirmed on 2026-10-27: `anthropic/pdf`,
`anthropic/docx`, `anthropic/xlsx`, `anthropic/frontend-design`, and
`anthropic/skill-creator`.

**Add manually → SkillMD** takes the same `owner/name` slug.

## Trust

Saving a skill downloads one file, `SKILL.md`, from
`https://api.skillmd.com/api/skills/{owner}/{name}/raw`. That address is built
from the slug. A `raw_url` that points anywhere else is ignored. Redirects are
not followed. The file must be markdown, at most 256 KB. Scripts, hooks, and
other files are not downloaded and are not run.

The text is untrusted. It is stored with a warning, so it stays off for every
bot. Turning it on opens the existing skill review, which shows the file
before it can be used. Names reject `..`, extra path segments, backslashes,
and encoded characters. Nothing in the skill text is followed automatically.

## How to add one

1. Open **Plugins**. Use **Add** on the SkillMD card if you want the MCP server.
2. Search under **Browse SkillMD**, or choose **Add manually → SkillMD** and enter `owner/name` (for example `anthropic/pdf`).
3. Save. Read the preview. The skill is off.
4. Open a bot’s skills, read the file there, and turn the skill on for that bot.
