---
description: Start prompt for dashboard
tools: ['codebase', 'usages', 'vscodeAPI', 'problems', 'changes', 'testFailure', 'terminalSelection', 'terminalLastCommand', 'openSimpleBrowser', 'fetch', 'findTestFiles', 'searchResults', 'githubRepo', 'extensions', 'editFiles', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'get_code_scanning_alert', 'get_commit', 'get_dependabot_alert', 'get_discussion', 'get_discussion_comments', 'get_file_contents', 'get_issue', 'get_issue_comments', 'get_job_logs', 'get_me', 'get_notification_details', 'get_pull_request', 'get_pull_request_comments', 'get_pull_request_diff', 'get_pull_request_files', 'get_pull_request_reviews', 'get_pull_request_status', 'get_secret_scanning_alert', 'get_tag', 'get_workflow_run', 'get_workflow_run_logs', 'get_workflow_run_usage', 'list_branches', 'list_code_scanning_alerts', 'list_commits', 'list_dependabot_alerts', 'list_discussions', 'list_gists', 'list_notifications', 'list_pull_requests', 'list_secret_scanning_alerts', 'list_sub_issues', 'list_tags', 'list_workflow_jobs', 'list_workflow_run_artifacts', 'list_workflow_runs', 'list_workflows', 'search_code', 'search_orgs', 'search_repositories', 'search_users', 'list_discussion_categories', 'list_issues', 'search_issues', 'search_pull_requests', 'context7', 'markitdown', 'sequentialthinking', 'memory', 'think', 'copilotCodingAgent', 'activePullRequest']'markitdown', 'sequentialthinking', 'memory', 'copilotCodingAgent', 'activePullRequest']
model: Claude Sonnet 4.5
---

#file:dashboard 
Lets create a Vite project for web components that we can then use for rendering widgets into the markdown editor.
sort of like we use https://github.com/phfsantos/kanban-board for #file:KanbanRenderer.ts 
We should use widgets components from https://github.com/wigggle-ui/ui check their website for some examples: https://wigggle-ui.vercel.app/widgets/dashboard
from the react we should wrap them as web components so that it is easy to use on the markdown component.
check this article for instructions https://techblog.skeepers.io/create-a-web-component-from-a-react-component-bbe7c5f85ee6
Let make a plan so that we can get some of the widgets into the editor.
Some requirements:
- Widgets should be able to read and be connected to one another. 
- We should have some sort of UI for settings and connections.
- Styles should still be accessible from the editor so we can pass vscode theme colors to the shadow CSS.
- Widgets should be able to execute scripts for example buttons to run a sh script on the code.
- Widgets should be able to get data from api calls as well so some explanation about data it should receive would be good.
- It is a for developers as it is inside of vscode so some level of customization and know how should be expected.
- Needs to have good documentation and good intuitive UI/UX for configuring and connecting to data.
- Some of the widgets can have some vscode api integrations as well like the timer widget can trigger a vscode notification when done.
- Saving data and access to data should be made external to the web component as it will be loaded and handled by the editor.
- We should have a plan for how to load the web components into the markdown editor and how to lazy load them for performance.
- We should have a plan for how to package and distribute the web components so that they can be updated independently of the markdown editor.
- We should have a plan for how to handle versioning of the web components so that breaking changes can be managed.
- We should have a plan for how to test the web components to ensure they work correctly in the markdown editor environment.
- We should have a plan for how to handle errors and exceptions within the web components to ensure they do not crash the markdown editor.
- We should have a plan for how to handle accessibility within the web components to ensure they are usable by all users.
- We should have a plan for how to handle internationalization within the web components to ensure they can be used by users in different languages.
- We should have a plan for how to handle performance optimization within the web components to ensure they do not slow down the markdown editor.
- We should have a plan for how to handle security within the web components to ensure they do not introduce vulnerabilities into the markdown editor.
- We should have a plan for how to handle user feedback and feature requests for the web components to ensure they meet the needs of users.
- We should have a plan for how to handle documentation and support for the web components to ensure users can easily find help when needed.
- We should have a plan for how to handle updates and maintenance for the web components to ensure they remain compatible with the markdown editor over time.
- We should have a plan for how to handle community contributions for the web components to encourage collaboration and innovation.
- We should have a plan for how to handle licensing and legal considerations for the web components to ensure compliance with relevant laws and regulations.
- We should have a plan for how to handle marketing and promotion for the web components to increase awareness and adoption.
- We should have a plan for how to handle analytics and usage tracking for the web components to gather insights and improve the user experience.
- We should have a plan for how to handle monetization and revenue generation for the web components to support ongoing development and maintenance.
- We should have a plan for how to handle partnerships and collaborations for the web components to leverage external expertise and resources.
- We should have a plan for how to handle future growth and scalability for the web components to ensure they can accommodate increasing demand and complexity.