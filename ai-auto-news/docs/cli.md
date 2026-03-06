# CLI

The CLI lives in `ai-auto-news/cli` and is published as `@ai-auto-news/cli` (bin names: `ai-auto-news` and `aan`).

## Development usage (local)

From this repo:

```bash
cd ai-auto-news/cli
npm install
node index.js --help
```

## Config file

The CLI stores config in:

- `~/.ai-auto-news/config.json`

Keys used:

- `apiKey` (string)
- `baseURL` (string)

## Pointing the CLI at localhost

The CLI supports setting config values:

```bash
ai-auto-news config set baseURL http://localhost:3000
ai-auto-news config set apiKey aian_...
ai-auto-news config show
```

### Important limitation

`ai-auto-news login` verifies an API key against a hard-coded hosted URL. For local development, skip `login` and set `baseURL` + `apiKey` directly using `config set` (or by editing the config file).

## Example commands

Once configured:

```bash
ai-auto-news posts list --limit 5
ai-auto-news generate blog "Latest AI trends"
ai-auto-news metrics
```

Note: the CLI calls `/api/v1/*` endpoints, so you need a valid local API key (see [API bootstrap](api.md#local-bootstrap-for-v1-api-key-testing)).

