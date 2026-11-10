---
name: refactor
description: Code Review Chat Mode for GitHub Copilot
disable-model-invocation: true
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
