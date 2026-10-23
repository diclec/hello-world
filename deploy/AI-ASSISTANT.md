# Local AI assistant with Ollama

The portal’s **AI Assistant** answers questions from saved records that the signed-in user can access. It is read only. It does not use a hosted AI provider, web search, shell commands, arbitrary SQL, or a shared conversation history.

## 1. Install the portal update

Follow [Upgrade your existing Raspberry Pi installation](CUSTOMERS.md#upgrade-your-existing-raspberry-pi-installation). Each new customer installation includes the assistant, initially disabled until its own environment settings are configured.

## 2. Install Ollama on your model server

Use a Linux machine with sufficient memory. The portal stays on the Pi; Ollama can run on another computer on your Tailscale network. A separate machine with at least 16 GB RAM is recommended for this configuration. A Pi may be slow or run out of memory with the model and long context used here; keep the portal on the Pi and use the other machine if that occurs.

On the machine that will run the model:

```sh
curl -fsSL https://ollama.com/install.sh -o /tmp/ollama-install.sh
less /tmp/ollama-install.sh
sh /tmp/ollama-install.sh
ollama pull llama3.2:3b
ollama run llama3.2:3b "Reply with the word ready."
```

`llama3.2:3b` is a starting point, not a requirement. You can use a stronger locally installed model that supports Ollama structured JSON output and at least a 49,152-token context. Larger models generally interpret questions more reliably. Model installation requires a download; portal questions are sent only to your configured Ollama server after that.

The portal requests `num_ctx=49152`, `num_predict=4096`, non-streaming structured output, and temperature 0. Check memory use on your hardware before adding users. An undersized or incompatible model may fail to return a valid plan; the portal shows an error instead of displaying model prose.

## 3. Make Ollama reachable from the Pi

**Ollama on the same Pi:** keep Ollama’s default localhost binding. Use `http://127.0.0.1:11434` as `PMO_AI_URL` below.

**Ollama on another machine:** install/sign in to Tailscale on that machine, then run:

```sh
tailscale ip -4
sudo systemctl edit ollama
```

Add this systemd override, replacing `MODEL_SERVER_TAILSCALE_IP` with the model machine’s actual `100.x.x.x` Tailscale address:

```ini
[Service]
Environment="OLLAMA_HOST=MODEL_SERVER_TAILSCALE_IP:11434"
```

Then restart Ollama:

```sh
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Allow the Pi to reach that machine’s Tailscale TCP port 11434 in your tailnet policy and any host firewall. Bind Ollama to that Tailscale address; do not expose it publicly or use Tailscale Funnel. Ollama’s HTTP service has no application login, so limit it to the Pi or trusted model clients. Other portal users connect only to the portal; their browsers do not call Ollama directly.

From the Pi, verify connectivity (replace the address):

```sh
curl --fail --max-time 10 http://MODEL_SERVER_TAILSCALE_IP:11434/api/tags
```

Check that `llama3.2:3b` appears in the returned model list.

## 4. Enable the assistant for this customer

For the original portal installation:

```sh
sudoedit /etc/pathtoo.env
```

Add these lines once, using localhost for a same-Pi model or the model server’s Tailscale address for another machine:

```ini
PMO_AI_ENABLED=true
PMO_AI_URL=http://127.0.0.1:11434
PMO_AI_MODEL=llama3.2:3b
```

`PMO_AI_URL` must be an HTTP/HTTPS origin with no path, credentials, query string or fragment. A trailing slash is accepted. It is a server setting, never a value supplied by the person asking a question. No OpenAI key is needed.

Restart only this customer’s portal:

```sh
sudo systemctl restart pathtoo
```

For a named customer such as `acme`, edit `/etc/pathtoo-acme.env` and restart `pathtoo-acme` instead. Other customers’ settings and data are independent. They can share the same stateless Ollama service or use different ones. Installation upgrades preserve existing environment settings.

To disable it, set `PMO_AI_ENABLED=false` and restart the customer service. The page remains available and explains that configuration is needed.

## 5. Try it in the portal

Sign in and open **AI Assistant** from the sidebar. Examples:

- “Which of my projects need attention?”
- “What is the total approved budget?” (select **Projects** as the record type)
- “Which tasks are assigned to me?” (select **Tasks**)
- “Show the open high-priority risks for Customer project.” (select that project and **RAID items**)
- “How many hours remain on Alex’s resource assignments?” (select **Resource assignments**)
- “Show the latest status reports for this project.” (select the project and **Status reports**)

Each question is independent; include the name or scope you mean. Use **Project scope** and **Record type** to narrow large datasets. The current request limit is 200 records and 28,000 bytes of projected context. If the scope is too large, the portal asks you to narrow it; it does not silently omit records. A single unusually long record may also require shortening its saved text before it fits.

Answers display facts copied from saved records, with source links to the relevant project section or directory. The model selects records and fields; the server validates those selections and constructs the answer. Totals and averages are calculated by the portal. Mixed currencies stay separate, and missing values are not treated as zero. Lists display up to 30 matched records, with all selected sources available underneath.

This grounding deliberately limits responses to saved facts and simple count/sum/average calculations. It does not generate unsupported advice, external research, or arbitrary free-form narratives. The model can still misunderstand a question or select the wrong matching records. Check the sources, use explicit scope, or rephrase when needed. No claim is made that an empty selection proves a record does not exist elsewhere in the system.

## Access and data handling

- Authentication, active-account checks and CSRF checks run on the portal server. Viewers can ask questions about the same records they can read normally.
- Project membership is applied before building the model context. Portfolio/program metadata follows the existing directory permissions. Accounts, invitations, passwords, session tokens, audit logs and server settings are not included.
- Only allowlisted saved fields and relevant derived values (such as remaining hours, remaining budget and calculated project health) are projected. Client-supplied context, role overrides, model endpoints and previous answers are rejected.
- Records are treated as untrusted input. The model has no write tools or access to the portal database, filesystem, web or user-management APIs. Model-generated answer prose is never displayed. Unknown IDs or unsupported fields cause the answer to be rejected.
- The portal revalidates the session and dataset after the model returns. Changes in access or data require a new question; disabled/revoked sessions cannot receive the pending answer.
- Requests are stateless. No chat history is sent to Ollama. Answers/drafts remain only in the current browser session and clear on sign-out or workspace reload; they are not saved to a shared chat table or local storage. Normal source records remain in the customer database.
- Audit history records the requesting user, action, source count and selected project, without saving question/answer text. Your Ollama host still processes the authorized data; configure its operating-system access and logs accordingly.
- The portal allows one in-flight request per user, two per portal process, and six attempts per user per minute. Each model request has a 90-second timeout. Choose a model/hardware combination that responds within that time.

## Troubleshooting

**“Not configured”**: check all three `PMO_AI_*` variables in the correct customer environment file and restart that service. The configuration status confirms settings exist; it does not perform a model health check.

**“Could not be reached or timed out”**: check `/api/tags` from the Pi, Tailscale connectivity, Ollama’s bind address, firewall/tailnet rules, and model-server memory. Preload the model with `ollama run` if cold loading is slow.

**“Could not complete the request”**: confirm the exact model name with `ollama list`; inspect `sudo journalctl -u ollama -n 50` on the model server. Do not share logs containing private prompts.

**Invalid or ungrounded plan**: use a stronger model, ask a narrower question, and select the record type. The portal will not fall back to displaying an unvalidated response.

**Data/access changed**: reload the workspace and ask again. If access was revoked, sign in again with your updated permissions.

The automated integration and browser tests use a local mock Ollama server; they test access boundaries, plan validation and the UI without downloading a model. Actual model quality, latency and memory use must be verified on your chosen Ollama host.
