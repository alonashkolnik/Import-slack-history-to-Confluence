Test-only TLS material for the Electron tests. Never used by the app.

`allowlisted.*` is a certificate the test launcher tells Chromium to accept via
`--ignore-certificate-errors-spki-list` (`allowlisted.spki` is its SPKI hash).
Atlassian Cloud is HTTPS-only (newer Chromium HSTS-upgrades atlassian.net), so
the mock Confluence Cloud server needs working HTTPS.
