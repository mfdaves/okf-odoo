# okf-odoo

`okf-odoo` reads the technical metadata of an Odoo database over Odoo's JSON-2
API and produces an Open Knowledge Format v0.2 bundle with explicit generation
provenance. It never reads business records.

## Status

Under construction. The package is a Producer API v1 producer for hosts such as
`okf-mcp`; it has no standalone command line.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run self:validate
npm run pack:check
```

`npm run self:validate` requires the sibling `../okf-mcp` checkout and validates
the reference bundle in `okf/okf-odoo`.
