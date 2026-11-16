# Public release-history and README media evidence — 2026-11-14

Read-only investigation for Markdown Studio pre-release readiness. No source,
release metadata, registries, tags, credentials or user installations were changed.

## Verified constraints

The local release identity is `phfsantos.markdown-editor`, version `0.5.14`.
Local files and filenames do not establish that any version was published.

## Public registry evidence

| Primary source | Observed result |
| --- | --- |
| https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor | HTTP 404, title `404 - Page not found` |
| Marketplace POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery with exact extension-id filter type 7 | HTTP 200; `extensions: []`, `TotalCount: 0` |
| https://open-vsx.org/api/phfsantos/markdown-editor/latest | HTTP 404; `{"deprecated":false,"downloadable":false,"error":"Extension not found: phfsantos.markdown-editor latest"}` |
| https://api.github.com/repos/phfsantos/vscode-markdown-editor/tags | HTTP 200, `[]` |
| https://api.github.com/repos/phfsantos/vscode-markdown-editor/releases | HTTP 200, `[]` |

There is no preceding published `phfsantos.markdown-editor` version established by
these public sources, and no public VSIX was downloaded. This does not prove no
version ever existed, nor rule out private/unlisted distribution. It establishes
that a **preceding-published-version upgrade test has no authoritative public
baseline available in this run**. Do not substitute another publisher's package.
A prior local artifact can support a separately labelled local continuity test.

Raw responses and HTTP headers are retained beside this report, including the
exact unauthenticated Marketplace query body and its response.

## README image accessibility

The public repository exists: `private:false`, default branch `master`, public
API `pushed_at: 2026-11-03T16:47:09Z`. Public `master/package.json` currently says
`zaaack.markdown-editor`, version `0.1.12`, display name `Markdown Editor`.
This public source state does not establish current local or registry identity.

All three image targets currently produced by VSCE's GitHub raw/HEAD rewriting
returned HTTP 302 then HTTP 200:

| URL | Bytes | Relationship to current local source |
| --- | ---: | --- |
| https://github.com/phfsantos/vscode-markdown-editor/raw/HEAD/media/logo.png | 2,356 | Different from the local new Markdown Studio tile |
| https://github.com/phfsantos/vscode-markdown-editor/raw/HEAD/media/screenshot-main.png | 313,043 | Equal to the pre-recapture local screenshot |
| https://github.com/phfsantos/vscode-markdown-editor/raw/HEAD/demo.gif | 2,554,050 | Equal to local demo |

Downloaded-image SHA-256:

- Logo: `c2d171088c864d39430784d88759147765b9f49fbb947ef4936827461fe58d86`
- Screenshot: `9174925d61abb17775fdd85e98d4a2c1aa5fa17a46a7ed3d372fe1f1f53ee9ae`
- Demo: `1bdb69873e9586a9a179bba6e20fbf5b6ea4f034d5694ce5c8d91b95cff86f96`

## Packaging recommendation

Keep pre-release readiness independent of publication. Verify the final VSIX's
manifest, installed icon and README rendering directly. The public image URLs are
accessible today but currently reference older logo artwork, and a newly captured
screenshot will differ until public source assets are synchronized.

For a self-contained pre-release artifact, include the README images and retain
relative image links only if the installed VSIX renderer proves they resolve.
Otherwise keep the future release checklist explicit: synchronize the new logo
and screenshot at the public release ref, use the intended immutable reference
when packaging, then inspect the rewritten README URLs before publishing. A
working old image URL is not proof that it displays the intended new artwork.

## Access notes

Sandbox curl could not resolve the registry host. Approved read-only escalated
curl reached the public endpoints. The web tool could not open the registry
pages; direct HTTP responses above are the authoritative evidence used here.
