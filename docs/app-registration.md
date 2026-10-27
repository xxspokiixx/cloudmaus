# App registration for plugin Connect

Connect opens the vendor’s authorize page. The person approves the permissions that server asks for. They do not type a tenant id, client id, client secret, or API key.

Sign-in is OAuth 2.0 authorization code with PKCE S256. If the authorization server advertises `registration_endpoint`, OpenMausBot registers a public client itself (dynamic client registration) on each sign-in. Nothing is stored in the catalog for that.

If it does not, register one **public** OAuth client (no client secret) and set `mcp.clientId` on that plugin in `shared/plugin-catalog.json`. Until that field is set, the card says **Needs app registration** and links here. There is no form on the card.

## Redirect URI

A pre-registered client always comes back to loopback. The port is chosen from the MCP URL and does not move. Path: `/mcp-oauth/callback`.

Dynamic registration on an https deployment (My Cloud, a hosted workspace) returns to `https://<the address you opened OpenMausBot at>/mcp-oauth/callback` instead, and only when the server allows self-registration. Do not register that address for the servers in the next section; they use the loopback URI.

Ask for an authorization-code public client with PKCE S256. Token endpoint auth method: `none`. Do not create a client secret, and do not paste one into the catalog.

## Works out of the box

Dynamic registration answered on the live metadata probe on 2026-10-27. Connect needs no client id.

- **Apify** (`apify`) — `https://mcp.apify.com`
  - Docs: https://docs.apify.com/platform/integrations/mcp
  - Scopes the server advertises: `full_api_access`
- **Asana** (`asana`) — `https://mcp.asana.com/mcp`
  - Docs: https://developers.asana.com/docs/using-asanas-mcp-server
  - Scopes the server advertises: `default`
- **Atlassian** (`atlassian`) — `https://mcp.atlassian.com/v2/mcp`
  - Docs: https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/
  - Scopes the server advertises: `read:me read:account offline_access email read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface delete:jira:agent-interface manage:jira:agent-interface read:confluence:agent-interface write:confluence:agent-interface search:confluence:agent-interface search:rovo:agent-interface search:code:agent-interface read:jsm:agent-interface write:jsm:agent-interface read:all:twg write:all:twg read:goals:agent-interface write:goals:agent-interface read:projects:agent-interface write:projects:agent-interface read:bitbucket:agent-interface write:bitbucket:agent-interface read:loom:agent-interface write:loom:agent-interface read:talent:agent-interface write:talent:agent-interface read:jira-align:agent-interface write:jira-align:agent-interface read:teams:agent-interface write:teams:agent-interface read:artifacts:agent-interface write:artifacts:agent-interface read:capacity-planning:agent-interface write:capacity-planning:agent-interface read:focus:agent-interface write:focus:agent-interface read:assets:agent-interface write:assets:agent-interface`
- **Canva** (`canva`) — `https://mcp.canva.com/mcp`
  - Docs: https://www.canva.dev/docs/connect/mcp-server/
  - Scopes the server advertises: `profile:read design:meta:read design:content:write design:content:read folder:read folder:write brandtemplate:content:read brandtemplate:meta:read brandtemplate:content:write comment:write comment:read asset:read asset:write brandkit:read help:answers:read help:answers:write`
- **Cloudflare** (`cloudflare`) — `https://mcp.cloudflare.com/mcp`
  - Docs: https://developers.cloudflare.com/agents/model-context-protocol/
  - Scopes the server advertises: `user:read account:read`
- **etoro** (`etoro-trading`) — `https://mcp.public-api.etoro.com`
  - Docs: https://api-portal.etoro.com/core/vibe-code/cursor
- **Exa** (`exa`) — `https://mcp.exa.ai/mcp`
  - Docs: https://docs.exa.ai/
  - Scopes the server advertises: `mcp:tools`
- **Figma** (`figma`) — `https://mcp.figma.com/mcp`
  - Docs: https://developers.figma.com/docs/figma-mcp-server/
  - Scopes the server advertises: `mcp:connect`
- **Linear** (`linear`) — `https://mcp.linear.app/mcp`
  - Docs: https://linear.app/docs/mcp
  - Scopes the server advertises: `read write`
- **Notion** (`notion`) — `https://mcp.notion.com/mcp`
  - Docs: https://developers.notion.com/guides/mcp/get-started-with-mcp
  - Scopes the server advertises: `default`
- **Sentry** (`sentry`) — `https://mcp.sentry.dev/mcp`
  - Docs: https://docs.sentry.io/product/sentry-mcp/
  - Scopes the server advertises: `org:read project:write team:write event:write alerts:write`
- **Stripe** (`stripe`) — `https://mcp.stripe.com`
  - Docs: https://docs.stripe.com/mcp
  - Scopes the server advertises: `mcp`
- **Tavily** (`tavily`) — `https://mcp.tavily.com/mcp`
  - Docs: https://docs.tavily.com/documentation/mcp
  - Scopes the server advertises: `openid offline_access`
- **Vercel** (`vercel`) — `https://mcp.vercel.com`
  - Docs: https://vercel.com/docs/agent-resources/vercel-mcp
  - Scopes the server advertises: `openid`
- **Whop** (`whop`) — `https://mcp.whop.com/mcp`
  - Docs: https://github.com/whopio/whop-mcp-server
  - Scopes the server advertises: `admin`

## Microsoft 365 is registered

Outlook, Outlook Calendar, Teams, SharePoint, and OneDrive share one server, `https://workiq.svc.cloud.microsoft/mcp`, and one public client id: `6bfa5a3d-30cd-4945-acff-4a925d2e9aa7`. That id is set on `onedrive`, `outlook`, `outlook-calendar`, `sharepoint`, and `teams`. No client secret is stored. Those five cards show **Connect**.

Redirect URI: `http://127.0.0.1:33871/mcp-oauth/callback`. Delegated scope: `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`. That GUID is Microsoft’s Work IQ resource. Sign-in uses `https://login.microsoftonline.com/organizations`, so the person is not asked for a tenant id.

The app registration that produced this client id uses a public client (mobile and desktop) with that redirect URI, **Allow public client flows**, and the delegated Work IQ scope. Microsoft’s token endpoint currently advertises `client_secret_post`, `private_key_jwt`, `client_secret_basic`, and `self_signed_tls_client_auth`. OpenMausBot sends PKCE S256 with token endpoint auth method `none`. If Microsoft rejects that exchange, sign-in stops. Do not add a secret to the catalog.

## Google Workspace — register one Web application for six cards

Checked against [Configure the Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers) (last updated 2026-10-27 UTC). The page is labeled Developer Preview.

Gmail, Google Calendar, Google Docs, Google Drive, Google Sheets, and Google Slides each have their own MCP URL, so each has its own loopback redirect URI. One OAuth client can hold all six. Google’s page also lists Chat, People, and Classroom. Those three are not Connect cards in this catalog.

### What Google’s page specifies

Google’s guide says to create the client as a **Web application**, turn on **Use this client for an AI-powered agent**, and copy both the client id and the client secret. The redirect URIs on that page are `https://antigravity.google/oauth-callback` and `https://claude.ai/api/mcp/auth_callback`.

A Desktop client is not described on that page, so a Desktop client cannot be verified as accepted by these MCP servers. PKCE with token endpoint auth method `none` is also absent: the Antigravity and Claude examples send a client secret, and the live authorization-server metadata for these hosts lists `client_secret_post` and `client_secret_basic`. Whether a Web application client with PKCE and no secret is accepted cannot be verified from Google’s docs. OpenMausBot still sends PKCE S256 and method `none`, and this catalog does not store a secret. If Google rejects that exchange, sign-in stops.

Google’s page says a refresh token is issued only when the authorization request includes `access_type=offline`. This app’s sign-in request sends `code_challenge` and `code_challenge_method=S256` and does not send `access_type`. Google says that without a refresh token the person signs in again about every hour.

The consent-screen scopes on Google’s page are shorter than the scopes in each server’s protected-resource metadata. Once `mcp.clientId` is set, Connect requests the metadata list under **Scopes Connect will request**. Whether Google’s consent screen accepts that longer list cannot be verified from the page.

### Steps

1. Join the Google Workspace Developer Preview Program. Google’s page lists that membership as a prerequisite.
2. In the same Google Cloud project, enable the product API and the MCP service for each card you want: Gmail API and `gmailmcp.googleapis.com`, Google Drive API and `drivemcp.googleapis.com`, Google Docs API and `docsmcp.googleapis.com`, Google Sheets API and `sheetsmcp.googleapis.com`, Google Slides API and `slidesmcp.googleapis.com`, Google Calendar API and `calendarmcp.googleapis.com`.
3. Open Google Auth Platform → Branding and finish the consent screen. Choose Audience **Internal** when the project allows it. When it does not, choose **External** and add test users. Under Data Access, add the scopes for the products you enable. Google’s page lists these consent-screen scopes:

   - Gmail: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`
   - Google Calendar: `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events.freebusy`, `https://www.googleapis.com/auth/calendar.events.readonly`
   - Google Docs: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/documents.readonly`, `https://www.googleapis.com/auth/documents`
   - Google Drive: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`
   - Google Sheets: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/spreadsheets.readonly`, `https://www.googleapis.com/auth/spreadsheets`
   - Google Slides: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/presentations.readonly`, `https://www.googleapis.com/auth/presentations`

4. Google Auth Platform → Clients → Create Client. Select **Web application**. Enter a name. Add these six authorized redirect URIs, exactly:

   - Gmail (`gmail`, `https://gmailmcp.googleapis.com/mcp/v1`): `http://127.0.0.1:30920/mcp-oauth/callback`
   - Google Calendar (`google-calendar`, `https://calendarmcp.googleapis.com/mcp/v1`): `http://127.0.0.1:31572/mcp-oauth/callback`
   - Google Docs (`google-docs`, `https://docsmcp.googleapis.com/mcp/v1`): `http://127.0.0.1:25227/mcp-oauth/callback`
   - Google Drive (`google-drive`, `https://drivemcp.googleapis.com/mcp/v1`): `http://127.0.0.1:26106/mcp-oauth/callback`
   - Google Sheets (`google-sheets`, `https://sheetsmcp.googleapis.com/mcp/v1`): `http://127.0.0.1:27862/mcp-oauth/callback`
   - Google Slides (`google-slides`, `https://slidesmcp.googleapis.com/mcp/v1`): `http://127.0.0.1:35428/mcp-oauth/callback`

5. Select **Use this client for an AI-powered agent**. Create the client. Google’s console shows a client secret next to the client id.
6. Copy only the client id into `shared/plugin-catalog.json` on `gmail`, `google-calendar`, `google-docs`, `google-drive`, `google-sheets`, and `google-slides`, each as `mcp.clientId`. Leave the client secret in Google’s console. There is no `clientSecret` field in the catalog.
7. Ship the catalog. Each of those six cards then shows Connect.

### Scopes Connect will request

These are the scopes from each server’s protected-resource metadata, probed 2026-10-27. They are the list Connect sends after a client id is set.

- **Gmail** (`gmail`): `https://mail.google.com/`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/gmail.drafts`, `https://www.googleapis.com/auth/gmail.drafts.create`, `https://www.googleapis.com/auth/gmail.drafts.readonly`, `https://www.googleapis.com/auth/gmail.labels`, `https://www.googleapis.com/auth/gmail.metadata`, `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.settings.basic`
- **Google Calendar** (`google-calendar`): `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/calendar.acls`, `https://www.googleapis.com/auth/calendar.calendarlist`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.calendars`, `https://www.googleapis.com/auth/calendar.calendars.readonly`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.events.freebusy`, `https://www.googleapis.com/auth/calendar.events.readonly`, `https://www.googleapis.com/auth/calendar.freebusy`, `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/calendar.settings.readonly`
- **Google Docs** (`google-docs`): `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/documents.readonly`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/documents`
- **Google Drive** (`google-drive`): `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`
- **Google Sheets** (`google-sheets`): `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/spreadsheets.readonly`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/spreadsheets`
- **Google Slides** (`google-slides`): `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/presentations.readonly`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/presentations`

## Still waiting on a public client id

These servers have a documented MCP URL and OAuth metadata, and the metadata has no `registration_endpoint`. `mcp.clientId` is still empty on GitHub, the six Google cards, HubSpot, Slack, X, and Zoom. No client id from a vendor sample, Cursor plugin, or HTTP header is copied in.

**Where the client id goes.** On that plugin’s `mcp` object in `shared/plugin-catalog.json`:

```json
"clientId": "the public client id"
```

There is no `clientSecret` field. Leave `clientId` out until you have one. The card then says Needs app registration and links to the vendor page for that product. The per-product steps below repeat the redirect URI and metadata scopes. The six Google cards follow **Google Workspace — register one Web application for six cards** above.

### GitHub

Catalog id: `github`

MCP URL: `https://api.githubcopilot.com/mcp/`

Registration docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:31706/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `repo`, `read:org`, `read:user`, `user:email`, `read:packages`, `write:packages`, `read:project`, `project`, `gist`, `notifications`
4. Put only the client id in `shared/plugin-catalog.json` under `github` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

Create a GitHub OAuth App (not a fine-grained PAT). Homepage URL can be https://github.com/milind-soni/OpenMausBot. Authorization callback URL is the redirect URI above. Enable Device Flow is unnecessary. Copy the Client ID. GitHub’s MCP metadata does not advertise dynamic registration; the PAT header flow exists but Connect uses the browser OAuth page, not a token box.

### Gmail

Catalog id: `gmail`

MCP URL: `https://gmailmcp.googleapis.com/mcp/v1`

Registration docs: https://developers.google.com/workspace/guides/configure-mcp-servers

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:30920/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `https://mail.google.com/`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/gmail.drafts`, `https://www.googleapis.com/auth/gmail.drafts.create`, `https://www.googleapis.com/auth/gmail.drafts.readonly`, `https://www.googleapis.com/auth/gmail.labels`, `https://www.googleapis.com/auth/gmail.metadata`, `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.settings.basic`
4. Put only the client id in `shared/plugin-catalog.json` under `gmail` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post`, `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Follow **Google Workspace — register one Web application for six cards** above for the client type, all six redirect URIs, both scope lists, and what Google’s page does not verify. A Desktop client is not described there.

### Google Calendar

Catalog id: `google-calendar`

MCP URL: `https://calendarmcp.googleapis.com/mcp/v1`

Registration docs: https://developers.google.com/workspace/guides/configure-mcp-servers

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:31572/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/calendar.acls`, `https://www.googleapis.com/auth/calendar.calendarlist`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.calendars`, `https://www.googleapis.com/auth/calendar.calendars.readonly`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.events.freebusy`, `https://www.googleapis.com/auth/calendar.events.readonly`, `https://www.googleapis.com/auth/calendar.freebusy`, `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/calendar.settings.readonly`
4. Put only the client id in `shared/plugin-catalog.json` under `google-calendar` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post`, `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Follow **Google Workspace — register one Web application for six cards** above for the client type, all six redirect URIs, both scope lists, and what Google’s page does not verify. A Desktop client is not described there.

### Google Docs

Catalog id: `google-docs`

MCP URL: `https://docsmcp.googleapis.com/mcp/v1`

Registration docs: https://developers.google.com/workspace/guides/configure-mcp-servers

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:25227/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/documents.readonly`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/documents`
4. Put only the client id in `shared/plugin-catalog.json` under `google-docs` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post`, `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Follow **Google Workspace — register one Web application for six cards** above for the client type, all six redirect URIs, both scope lists, and what Google’s page does not verify. A Desktop client is not described there.

### Google Drive

Catalog id: `google-drive`

MCP URL: `https://drivemcp.googleapis.com/mcp/v1`

Registration docs: https://developers.google.com/workspace/guides/configure-mcp-servers

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:26106/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`
4. Put only the client id in `shared/plugin-catalog.json` under `google-drive` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post`, `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Follow **Google Workspace — register one Web application for six cards** above for the client type, all six redirect URIs, both scope lists, and what Google’s page does not verify. A Desktop client is not described there.

### Google Sheets

Catalog id: `google-sheets`

MCP URL: `https://sheetsmcp.googleapis.com/mcp/v1`

Registration docs: https://developers.google.com/workspace/guides/configure-mcp-servers

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:27862/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/spreadsheets.readonly`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/spreadsheets`
4. Put only the client id in `shared/plugin-catalog.json` under `google-sheets` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post`, `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Follow **Google Workspace — register one Web application for six cards** above for the client type, all six redirect URIs, both scope lists, and what Google’s page does not verify. A Desktop client is not described there.

### Google Slides

Catalog id: `google-slides`

MCP URL: `https://slidesmcp.googleapis.com/mcp/v1`

Registration docs: https://developers.google.com/workspace/guides/configure-mcp-servers

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:35428/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/presentations.readonly`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/presentations`
4. Put only the client id in `shared/plugin-catalog.json` under `google-slides` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post`, `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Follow **Google Workspace — register one Web application for six cards** above for the client type, all six redirect URIs, both scope lists, and what Google’s page does not verify. A Desktop client is not described there.

### HubSpot

Catalog id: `hubspot`

MCP URL: `https://mcp.hubspot.com`

Registration docs: https://developers.hubspot.com/docs/guides/apps/public-apps/overview

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:34684/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: the metadata listed none; use the scopes on the vendor page.
4. Put only the client id in `shared/plugin-catalog.json` under `hubspot` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

### OneDrive

Catalog id: `onedrive`

MCP URL: `https://workiq.svc.cloud.microsoft/mcp`

Registration docs: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

Registered. Public client id `6bfa5a3d-30cd-4945-acff-4a925d2e9aa7` is on `mcp.clientId`. No client secret is stored. This card shows Connect. Redirect URI `http://127.0.0.1:33871/mcp-oauth/callback`. Scope `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`. Sign-in uses the **organizations** endpoint. See **Microsoft 365 is registered**.

### Outlook

Catalog id: `outlook`

MCP URL: `https://workiq.svc.cloud.microsoft/mcp`

Registration docs: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

Registered. Public client id `6bfa5a3d-30cd-4945-acff-4a925d2e9aa7` is on `mcp.clientId`. No client secret is stored. This card shows Connect. Redirect URI `http://127.0.0.1:33871/mcp-oauth/callback`. Scope `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`. Sign-in uses the **organizations** endpoint. See **Microsoft 365 is registered**.

### Outlook Calendar

Catalog id: `outlook-calendar`

MCP URL: `https://workiq.svc.cloud.microsoft/mcp`

Registration docs: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

Registered. Public client id `6bfa5a3d-30cd-4945-acff-4a925d2e9aa7` is on `mcp.clientId`. No client secret is stored. This card shows Connect. Redirect URI `http://127.0.0.1:33871/mcp-oauth/callback`. Scope `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`. Sign-in uses the **organizations** endpoint. See **Microsoft 365 is registered**.

### SharePoint

Catalog id: `sharepoint`

MCP URL: `https://workiq.svc.cloud.microsoft/mcp`

Registration docs: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

Registered. Public client id `6bfa5a3d-30cd-4945-acff-4a925d2e9aa7` is on `mcp.clientId`. No client secret is stored. This card shows Connect. Redirect URI `http://127.0.0.1:33871/mcp-oauth/callback`. Scope `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`. Sign-in uses the **organizations** endpoint. See **Microsoft 365 is registered**.

### Slack

Catalog id: `slack`

MCP URL: `https://mcp.slack.com/mcp`

Registration docs: https://docs.slack.dev/ai/slack-mcp-server/

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:36284/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `canvases:read`, `canvases:write`, `channels:history`, `channels:read`, `channels:write`, `chat:write`, `emoji:read`, `files:read`, `files:write`, `groups:history`, `groups:read`, `groups:write`, `im:history`, `im:read`, `im:write`, `lists:read`, `lists:write`, `mpim:history`, `mpim:read`, `mpim:write`, `reactions:read`, `reactions:write`, `search:read.files`, `search:read.im`, `search:read.mpim`, `search:read.private`, `search:read.public`, `search:read.users`, `users:read`, `users:read.email`
4. Put only the client id in `shared/plugin-catalog.json` under `slack` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_post` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

Create a Slack app at https://api.slack.com/apps, add the redirect URI, and turn on the scopes listed above (Slack’s MCP docs group them as the bot and user scopes the hosted server checks). Copy the Client ID. Slack’s metadata currently allows only `client_secret_post`.

### Teams

Catalog id: `teams`

MCP URL: `https://workiq.svc.cloud.microsoft/mcp`

Registration docs: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

Registered. Public client id `6bfa5a3d-30cd-4945-acff-4a925d2e9aa7` is on `mcp.clientId`. No client secret is stored. This card shows Connect. Redirect URI `http://127.0.0.1:33871/mcp-oauth/callback`. Scope `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`. Sign-in uses the **organizations** endpoint. See **Microsoft 365 is registered**.

### X

Catalog id: `x`

MCP URL: `https://api.x.com/mcp`

Registration docs: https://docs.x.com/tools/mcp

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:23244/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `tweet.read`, `users.read`, `follows.read`, `space.read`, `mute.read`, `like.read`, `list.read`, `list.write`, `block.read`, `block.write`, `bookmark.read`, `bookmark.write`, `dm.read`, `dm.write`, `calls.read`, `calls.write`, `broadcast.read`, `broadcast.write`, `developer.billing.write`, `developer.write`, `media.write`, `offline.access`
4. Put only the client id in `shared/plugin-catalog.json` under `x` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

### Zoom

Catalog id: `zoom`

MCP URL: `https://mcp.zoom.us/mcp/zoom/streamable`

Registration docs: https://developers.zoom.us/docs/mcp/

1. Create a public OAuth client named OpenMausBot. Do not generate a client secret.
2. Register this redirect URI, exactly: `http://127.0.0.1:24963/mcp-oauth/callback`
3. Scopes from the server’s protected-resource metadata: `docs:read:export`, `agentic_search:read:search`, `my_notes:read:content`, `meeting:update:in_meeting_controls`, `docs:write:import`, `cloud_recording:read:content`, `docs:read:list_file_collaborators`, `docs:delete:collaborator`, `meeting:write:meeting`, `meeting:read:assets`, `agentic_search:read:ask`, `hub:read:content`, `meeting:read:search`, `meeting:delete:meeting`, `meeting:update:meeting`, `hub:write:content`, `docs:update:collaborator`, `cloud_recording:read:list_user_recordings`, `docs:write:collaborator`, `workflow:read:definition`, `workflow:write:definition`, `workflow:read:list_definitions`
4. Put only the client id in `shared/plugin-catalog.json` under `zoom` → `mcp.clientId`.
5. Ship the catalog. Connect then opens the vendor’s authorize page.

The live metadata lists token endpoint auth `client_secret_basic` and does not list `none`. OpenMausBot still sends a public client with PKCE and no secret. If the vendor rejects that, the sign-in stops. Do not add a secret to the catalog to force it through.

## Not offered as Connect

No Connect button. Either there is no documented hosted URL, or the only address found was a Cursor proxy (`api.cursor.com`), a `${placeholder}`, or a URL whose OAuth metadata did not answer. Unverified candidate URLs are kept on the card data with `verified: false` so they are not called.

- **Ahrefs** — unverified candidate `https://api.ahrefs.com/mcp/mcp` (metadata answered, DCR yes). Docs: https://ahrefs.com/mcp
- **Amplemarket** — unverified candidate `https://mcp.amplemarket.com/mcp` (metadata answered, DCR yes). Docs: https://knowledge.amplemarket.com/articles/8022685319-connecting-to-the-amplemarket-mcp-server
- **Ashby** — unverified candidate `https://mcp.ashbyhq.com/mcp/v1` (metadata answered, DCR yes). Docs: https://docs.ashbyhq.com/ashby-mcp-server-beta
- **Attio** — unverified candidate `https://mcp.attio.com/mcp` (metadata answered, DCR yes). Docs: https://docs.attio.com/mcp/overview
- **beehiiv** — unverified candidate `https://mcp.beehiiv.com/mcp` (metadata answered, DCR yes). Docs: https://www.beehiiv.com/support/article/39255979546263-getting-started-with-the-beehiiv-mcp
- **Brevo** — unverified candidate `https://mcp.brevo.com/v1/brevo/mcp` (metadata answered, DCR yes). Docs: https://developers.brevo.com/docs/mcp-protocol
- **Brex** — unverified candidate `https://api.brex.com/mcp` (metadata answered, DCR yes). Docs: https://developer.brex.com/docs/mcp
- **Buffer** — unverified candidate `https://mcp.buffer.com/mcp` (metadata answered, DCR yes). Docs: https://developers.buffer.com/guides/integrations/mcp.html
- **Calendly** — unverified candidate `https://mcp.calendly.com/` (metadata answered, DCR yes). Docs: https://developer.calendly.com/calendly-mcp-server
- **Circleback** — unverified candidate `https://circleback.ai/api/mcp` (metadata answered, DCR yes). Docs: https://support.circleback.ai/en/articles/13249081-circleback-mcp
- **Clay** — unverified candidate `https://api.clay.com/v3/mcp` (metadata answered, DCR yes). Docs: https://university.clay.com/docs/connect-to-clay-mcp
- **Coda** — unverified candidate `https://docs.superhuman.com/apis/mcp` (metadata answered, DCR yes). Docs: https://help.superhuman.com/hc/en-us/articles/46210076980365-Connect-to-the-Coda-MCP
- **Coinbase** — unverified candidate `https://agents.coinbase.com/mcp` (metadata answered, DCR yes). Docs: https://docs.cdp.coinbase.com/coinbase-for-agents/overview
- **Craft** — unverified candidate `https://mcp.craft.do/my/mcp` (metadata answered, DCR yes). Docs: https://www.craft.do/imagine/guide/mcp
- **Customer.io** — unverified candidate `https://mcp.customer.io/mcp` (metadata answered, DCR yes). Docs: https://docs.customer.io/ai/mcp/
- **Daloopa** — unverified candidate `https://mcp.daloopa.com/server/mcp` (metadata answered, DCR yes). Docs: https://docs.daloopa.com/docs/daloopa-mcp
- **Databricks Genie One** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/databricks-genie-one
- **Docusign** — unverified candidate `https://mcp.docusign.com/mcp` (metadata did not answer, DCR no). Docs: https://developers.docusign.com/platform/mcp-server/
- **Excalidraw** — unverified candidate `https://mcp.excalidraw.com/mcp` (metadata did not answer, DCR no). Docs: https://github.com/excalidraw/excalidraw-mcp
- **Fathom** — unverified candidate `https://api.fathom.ai/mcp` (metadata answered, DCR yes). Docs: https://developers.fathom.ai/mcp-docs
- **Feishu** — unverified candidate `https://mcp.feishu.cn/mcp` (metadata answered, DCR yes). Docs: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction
- **Finance** — unverified candidate `https://connectors-gateway.grok.com/gateway/v1/finance/mcp` (metadata did not answer, DCR no). Docs: https://grok.com/connectors
- **Finary** — unverified candidate `https://public-api.finary.com/mcp` (metadata answered, DCR yes). Docs: https://finary.com/en/mcp
- **Firecrawl** — no concrete public MCP URL. Docs: https://docs.firecrawl.dev
- **Fireflies** — unverified candidate `https://api.fireflies.ai/mcp` (metadata answered, DCR yes). Docs: https://docs.fireflies.ai/getting-started/mcp-configuration
- **Framer** — unverified candidate `https://mcp.framer.com/mcp` (metadata answered, DCR yes). Docs: https://www.framer.com
- **Gamma** — unverified candidate `https://mcp.gamma.app/mcp` (metadata answered, DCR yes). Docs: https://developers.gamma.app/mcp/gamma-mcp-server.md
- **GoDaddy** — unverified candidate `https://api.godaddy.com/v1/domains/mcp` (metadata did not answer, DCR no). Docs: https://developer.godaddy.com/en/docs/api-users/mcp
- **Gong** — unverified candidate `https://mcp.gong.io/mcp` (metadata answered, DCR yes). Docs: https://help.gong.io/docs/about-gong-mcp-server
- **Google Ads** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/google-ads
- **Google Cloud BigQuery** — unverified candidate `https://bigquery.googleapis.com/mcp` (metadata answered, DCR no). Docs: https://docs.cloud.google.com/bigquery/docs/use-bigquery-mcp
- **Gopuff** — unverified candidate `https://mcp.gopuff.com/mcp` (metadata answered, DCR yes). Docs: https://www.gopuff.com
- **Greenhouse** — unverified candidate `https://mcp.us.greenhouse.io/mcp` (metadata answered, DCR yes). Docs: https://support.greenhouse.io/hc/en-us/articles/52090956642075-Greenhouse-MCP
- **Guru** — unverified candidate `https://mcp.api.getguru.com/mcp` (metadata answered, DCR yes). Docs: https://developer.getguru.com/docs/guru-mcp-server-overview
- **Gusto** — unverified candidate `https://mcp.api.gusto.com/` (metadata answered, DCR yes). Docs: https://docs.gusto.com/app-integrations/docs/mcp
- **HighLevel** — unverified candidate `https://services.leadconnectorhq.com/mcp/cursor/v2` (metadata answered, DCR yes). Docs: https://help.leadconnectorhq.com/support/solutions/articles/155000008185
- **Hunter** — unverified candidate `https://mcp.hunter.io/mcp` (metadata answered, DCR yes). Docs: https://hunter.io/agents.md
- **Interactive Brokers** — unverified candidate `https://api.ibkr.com/v1/api/mcp-public` (metadata answered, DCR yes). Docs: https://www.interactivebrokers.com/en/trading/ai-integrations.php
- **Intercom** — unverified candidate `https://mcp.intercom.com/mcp` (metadata answered, DCR yes). Docs: https://developers.intercom.com/docs/guides/mcp
- **Jobber** — unverified candidate `https://mcp.getjobber.com/mcp` (metadata answered, DCR no). Docs: https://www.getjobber.com/
- **Jotform** — unverified candidate `https://mcp.jotform.com` (metadata answered, DCR yes). Docs: https://www.jotform.com/mcp/
- **Juicebox** — unverified candidate `https://mcp.juicebox.ai/v1` (metadata answered, DCR yes). Docs: https://docs.juicebox.ai/juicebox-mcp
- **Klaviyo** — unverified candidate `https://mcp.klaviyo.com/mcp` (metadata answered, DCR yes). Docs: https://developers.klaviyo.com/en/docs/klaviyo_mcp_server
- **Kraken** — no concrete public MCP URL. Docs: https://docs.kraken.com
- **Lark** — unverified candidate `https://mcp.larksuite.com/mcp` (metadata answered, DCR yes). Docs: https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction
- **MailerLite** — unverified candidate `https://mcp.mailerlite.com/mcp` (metadata answered, DCR yes). Docs: https://developers.mailerlite.com/mcp
- **Meltwater** — unverified candidate `https://api.meltwater.com/v2/mcp` (metadata answered, DCR yes). Docs: https://developer.meltwater.com/guides/meltwater-mcp/overview
- **Mem** — unverified candidate `https://mcp.mem.ai/mcp` (metadata answered, DCR yes). Docs: https://docs.mem.ai/mcp/overview
- **Meta Ads** — unverified candidate `https://mcp.facebook.com/ads` (metadata answered, DCR yes). Docs: https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started
- **Navan** — unverified candidate `https://mcp.navan.com/mcp` (metadata answered, DCR yes). Docs: https://developer.navan.com/mcp/
- **Otter.ai** — unverified candidate `https://mcp.otter.ai/mcp` (metadata answered, DCR yes). Docs: https://help.otter.ai/hc/en-us/articles/35287607569687-Otter-MCP-Server
- **Outreach** — unverified candidate `https://api.outreach.io/mcp` (metadata answered, DCR yes). Docs: https://developers.outreach.io/mcp-server
- **PitchBook** — unverified candidate `https://premium.mcp.pitchbook.com/mcp` (metadata answered, DCR yes). Docs: https://pitchbook.com
- **Plaud** — unverified candidate `https://mcp.plaud.ai/mcp` (metadata answered, DCR yes). Docs: https://docs.plaud.ai/plaud-mcp-cli/mcp
- **Playwright** — no concrete public MCP URL. Docs: https://github.com/microsoft/playwright-mcp
- **PostHog MCP** — unverified candidate `https://mcp.posthog.com/mcp` (metadata answered, DCR yes). Docs: https://posthog.com/docs/model-context-protocol
- **Power BI** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/power-bi
- **Profound** — unverified candidate `https://mcp.tryprofound.com/mcp` (metadata answered, DCR yes). Docs: https://docs.tryprofound.com/mcp/overview
- **QuickBooks Online** — unverified candidate `https://mcp-e2e.quickbooks.intuit.com/mcp` (metadata answered, DCR yes). Docs: https://github.com/cursor/plugins/tree/main/third_party/quickbooks-online
- **Readwise** — unverified candidate `https://mcp2.readwise.io/mcp` (metadata answered, DCR yes). Docs: https://docs.readwise.io/tools/mcp
- **RingCentral Chat** — unverified candidate `https://mcp.labs.ringcentral.com/ringex/v1.1.0/team-chat` (metadata answered, DCR yes). Docs: https://www.ringcentral.com
- **RingCentral Phone** — unverified candidate `https://mcp.labs.ringcentral.com/ringex/phone` (metadata answered, DCR yes). Docs: https://www.ringcentral.com
- **Robinhood** — unverified candidate `https://agent.robinhood.com/mcp/trading` (metadata answered, DCR yes). Docs: https://robinhood.com/us/en/support/articles/agentic-trading-overview/
- **S&P Global** — unverified candidate `https://kfinance.kensho.com/integrations/mcp` (metadata answered, DCR yes). Docs: https://docs.kensho.com/llmreadyapi/overview
- **Salesforce** — no concrete public MCP URL. Docs: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/cursor.html
- **Salesforce (Headless 360, Beta)** — no concrete public MCP URL. Docs: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/headless-360-mcp.html
- **Semrush** — unverified candidate `https://mcp.semrush.com/v2/mcp` (metadata answered, DCR yes). Docs: https://developer.semrush.com/api/v4/introduction/semrush-mcp/
- **ServiceNow** — no concrete public MCP URL. Docs: https://www.servicenow.com/docs/r/australia/intelligent-experiences/exploring-mcp-server-console.html
- **Shopify** — unverified candidate `https://setup.shopify.com/mcp` (metadata answered, DCR no). Docs: https://grok.com/connectors
- **Similarweb** — unverified candidate `https://mcp.similarweb.com` (metadata answered, DCR yes). Docs: https://docs.similarweb.com/api-v5/similarweb-mcp
- **Smartsheet** — unverified candidate `https://mcp.smartsheet.com` (metadata did not answer, DCR no). Docs: https://developers.smartsheet.com/ai-mcp/smartsheet/mcp-server
- **Square** — unverified candidate `https://mcp.squareup.com/mcp` (metadata answered, DCR yes). Docs: https://developer.squareup.com/docs/mcp
- **Stable** — unverified candidate `https://mcp.usestable.com/mcp` (metadata did not answer, DCR no). Docs: https://usestable.com
- **Statsig** — unverified candidate `https://api.statsig.com/v3/mcp` (metadata answered, DCR yes). Docs: https://docs.statsig.com/integrations/mcp/cursor
- **TikTok for Business** — unverified candidate `https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer` (metadata answered, DCR yes). Docs: https://business-api.tiktok.com/portal/docs/tiktok-ads-mcp-server/v1.3
- **TinyFish** — unverified candidate `https://agent.tinyfish.ai/mcp` (metadata answered, DCR yes). Docs: https://docs.tinyfish.ai/mcp-integration
- **Todoist** — unverified candidate `https://ai.todoist.net/mcp` (metadata answered, DCR yes). Docs: https://github.com/Doist/todoist-mcp
- **Trello** — unverified candidate `https://mcp.trello.com/v1` (metadata answered, DCR yes). Docs: https://github.com/atlassian/trello-mcp-server
- **Typeform** — unverified candidate `https://api.typeform.com/mcp` (metadata answered, DCR yes). Docs: https://developers.typeform.com/developers/get-started/mcp/
- **Upwork** — unverified candidate `https://mcp.upwork.com/mcp` (metadata answered, DCR yes). Docs: https://www.upwork.com/ai/mcp
- **Vanta** — no concrete public MCP URL. Docs: https://www.vanta.com
- **Webull** — unverified candidate `https://api.webull.com/mcp` (metadata answered, DCR yes). Docs: https://developer.webull.com/apis/docs/AI-friendly-Resources/mcp/
- **WhatsApp Business** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/whatsapp-business
- **Workable** — unverified candidate `https://mcp.workable.com/mcp` (metadata answered, DCR yes). Docs: https://workable.readme.io/reference/workable-mcp-server
- **Workday** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/workday
- **Wrike** — unverified candidate `https://mcp.wrike.com/v2` (metadata answered, DCR no). Docs: https://developers.wrike.com/docs/wrike-mcp-server-overview
- **X Ads** — unverified candidate `https://ads-api.x.com/mcp` (metadata answered, DCR no). Docs: https://docs.x.com/x-ads-api/introduction
- **X Money** — unverified candidate `https://mcp.money.x.com/mcp` (metadata answered, DCR no). Docs: https://x.com/i/money
- **Xero** — no concrete public MCP URL. Docs: https://github.com/XeroAPI/xero-mcp-server
- **Zoho Books** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/zoho-books
- **Zoho CRM** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/zoho-crm
- **Zoho Desk** — no concrete public MCP URL. Docs: https://github.com/cursor/plugins/tree/main/third_party/zoho-desk

## Skills packs

Install copies `SKILL.md` files into the shared imported-skills library every bot already receives. Hooks, commands, and other scripts in the pack are not downloaded and not run.

- **Advisor** — https://github.com/cursor/plugins/tree/main/advisor
- **Agent Compatibility** — https://github.com/cursor/plugins/tree/main/agent-compatibility
- **CLI for Agents** — https://github.com/cursor/plugins/tree/main/cli-for-agent
- **Continual Learning** — https://github.com/cursor/plugins/tree/main/continual-learning
- **Create Plugin** — https://github.com/cursor/plugins/tree/main/create-plugin
- **Cursor SDK** — https://github.com/cursor/plugins/tree/main/cursor-sdk
- **Cursor Team Kit** — https://github.com/cursor/plugins/tree/main/cursor-team-kit
- **Docs Canvas** — https://github.com/cursor/plugins/tree/main/docs-canvas
- **dyl-stack** — https://github.com/cursor/plugins/tree/main/dyl-stack
- **Google Docs** — https://github.com/cursor/plugins/tree/main/third_party/google-docs
- **Google Drive** — https://github.com/cursor/plugins/tree/main/third_party/google-drive
- **Google Sheets** — https://github.com/cursor/plugins/tree/main/third_party/google-sheets
- **Google Slides** — https://github.com/cursor/plugins/tree/main/third_party/google-slides
- **Grok Voice** — https://github.com/cursor/plugins/tree/main/grok-voice
- **Orchestrate** — https://github.com/cursor/plugins/tree/main/orchestrate
- **Origin Apps** — https://github.com/cursor/plugins/tree/main/origin-apps
- **Parallel** — https://github.com/parallel-web/parallel-cursor-plugin
- **PR Review Canvas** — https://github.com/cursor/plugins/tree/main/pr-review-canvas
- **pstack** — https://github.com/cursor/plugins/tree/main/pstack
- **Ralph Loop** — https://github.com/cursor/plugins/tree/main/ralph-loop
- **Tailscale** — https://github.com/cursor/plugins/tree/main/third_party/tailscale
- **Teaching** — https://github.com/cursor/plugins/tree/main/teaching
- **Thermos** — https://github.com/cursor/plugins/tree/main/thermos
- **X** — https://github.com/cursor/plugins/tree/main/third_party/x
- **X Money** — https://github.com/cursor/plugins/tree/main/third_party/x-money

