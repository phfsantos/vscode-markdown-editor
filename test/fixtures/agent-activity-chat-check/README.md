# Manual native Chat activity check

Install this test-only extension in the VS Code window containing the disposable
`tasks.md` with actual native Chat edits still pending review. Markdown Studio
must be a build exposing `markdown-editor.agentActivity.*` commands. This fixture
uses public command RPC with real URI arguments, including across remote hosts.

1. Focus `tasks.md` in its native text editor. Leave Chat changes pending.
2. Run **Markdown Activity Check: Start on tasks.md** from the Command Palette.
   The report must say `reported: true` and `preserved: true`. A missing command
   means the installed Markdown Studio build lacks the required activity API.
3. Capture native tab/Explorer decorations and Chat's pending edit UI together.
   Keep the same resource open in Markdown Studio as well; capture its task
   indicator and header/status fallbacks. Badge composition/order is observed,
   not guaranteed; a competing badge may suppress the activity badge.
4. Run **Markdown Activity Check: Clear Activity**. Verify the activity clears
   while native Chat edits remain pending; capture that view too.
5. Run **Markdown Activity Check: Show Report** and copy the JSON from Output.
   It includes exact VS Code/provider versions and before/after text/disk hashes,
   document version, dirty state and scoped configuration values. Both start and
   clear preservation checks must pass. Do not edit or accept/reject Chat changes
   during each command's preservation snapshot.

The report is also saved in this fixture's extension global storage as
`report.json`. It contains the test URI and hashes, not document content or
credentials. The fixture never calls authentication/model APIs, saves source or
writes product settings. Only its own report storage is written. Activity is
cleared on command or after ten minutes; uninstall the fixture when done.

This fixture does not itself prove that an authenticated native Chat edit
session exists, or that any third-party agent adopts the activity API. Retain
screenshots of the real pending-edit UI alongside its report.
