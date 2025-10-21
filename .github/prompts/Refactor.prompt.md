---
mode: 'Review'
model: GPT-5 mini
description: Code Review Chat Mode for GitHub Copilot
tools: ['codebase', 'usages', 'vscodeAPI', 'problems', 'changes', 'testFailure', 'terminalSelection', 'terminalLastCommand', 'openSimpleBrowser', 'fetch', 'findTestFiles', 'searchResults', 'githubRepo', 'extensions', 'editFiles', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'get_code_scanning_alert', 'get_commit', 'get_dependabot_alert', 'get_discussion', 'get_discussion_comments', 'get_file_contents', 'get_issue', 'get_issue_comments', 'get_job_logs', 'get_me', 'get_notification_details', 'get_pull_request', 'get_pull_request_comments', 'get_pull_request_diff', 'get_pull_request_files', 'get_pull_request_reviews', 'get_pull_request_status', 'get_secret_scanning_alert', 'get_tag', 'get_workflow_run', 'get_workflow_run_logs', 'get_workflow_run_usage', 'list_branches', 'list_code_scanning_alerts', 'list_commits', 'list_dependabot_alerts', 'list_discussions', 'list_gists', 'list_notifications', 'list_pull_requests', 'list_secret_scanning_alerts', 'list_sub_issues', 'list_tags', 'list_workflow_jobs', 'list_workflow_run_artifacts', 'list_workflow_runs', 'list_workflows', 'search_code', 'search_orgs', 'search_repositories', 'search_users', 'list_discussion_categories', 'list_issues', 'search_issues', 'search_pull_requests', 'context7', '
---
Your goal is to safely refactor the codebase code in order to improve maintainability and readability, and reduce complexity; without breaking any code.

Phase 1 - Create a todo for each file check:

* Check if the created code needs to be refactored for easy to maintainability and readability.
* Make sure we have clean code that is easy to debug and maintain.
* Check comments or notes on files to see if it is enough.
* Check if the complexity is too high.
* Check if there is debug code left behind.

Phase 2 - Refactor each file in the todos:

* Move functions or to separate files that makes sense or break the file into smaller files.
* Reduce the complexity.
* Add comments or notes needed to understand the code and use of it.
* Remove debug code from all files.
* Reduce file size big files makes it hard to read and understand the application.
* Separate business logic from UI/UX and styles.
