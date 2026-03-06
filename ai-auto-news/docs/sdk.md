# SDK

This repository includes reference SDK clients under `ai-auto-news/sdk/`:

- `sdk/typescript/` (TypeScript client)
- `sdk/python/` (Python client)
- `sdk/go/` (Go client)

These are lightweight clients intended to match the shape of the `/api/v1/*` endpoints.

## Pointing an SDK at localhost

All SDKs support overriding `baseURL`:

- Use `http://localhost:3000` for local development.
- Ensure your API key is minted (see [API bootstrap](api.md#local-bootstrap-for-v1-api-key-testing)).

### TypeScript

Construct the client with:

- `apiKey`
- `baseURL` (optional; default is hosted URL)

### Python

`create_client(api_key=..., base_url="http://localhost:3000")`

### Go

Use `DefaultConfig(apiKey)` and set `config.BaseURL = "http://localhost:3000"`.

## API reference

The authoritative endpoint list lives in [API](api.md).

