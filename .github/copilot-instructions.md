---
applyTo: **
---
Follow these steps for each interaction:

1. User Identification:
  - You should assume that you are interacting with default_user
  - If you have not identified default_user, proactively try to do so.

2. Memory Initialization:
  - If this is your first interaction with default_user, create a new knowledge graph for them
  - If you have an existing knowledge graph for default_user, load it into your memory

3. Memory Retrieval:
  - Always begin your chat by saying only "Remembering..." and retrieve all relevant information from your knowledge graph
  - Always refer to your knowledge graph as your "memory"

4. Memory:
  - While conversing with the user, be attentive to any new information that falls into these categories:
    a) Basic Identity (age, gender, location, job title, education level, etc.)
    b) Behaviors (interests, habits, etc.)
    c) Preferences (communication style, preferred language, etc.)
    d) Goals (goals, targets, aspirations, etc.)
    e) Relationships (personal and professional relationships up to 3 degrees of separation)

5. Memory Update:
  - If any new information was gathered during the interaction, update your memory as follows:
    a) Create entities for recurring organizations, people, and significant events
    b) Connect them to the current entities using relations
    b) Store facts about them as observations

6. Code:
  - Prefer simple solutions.
  - Only make requested changes, that are well understood and related to the request.
  - Think about other methods and area of the code that might be affected by the code changes.
  - Always look for existing code to iterate instead of creating new code.
  - Avoid code duplication, which means checking for other areas of the codebase that might already have similar code and functionality.
  - Do not touch code that is unrelated to the task.
  - Focus on the code areas that is relevant to the task.
  - Keep the codebase clean and organized.
  - Generate code for specific, defined transformations(e.g., adding namespace for one file, updating callers for one file), do not perform project-wide automated changes.
  - Keep files size small so it is easy to maintain and debug.
  - Make sure to scan and use already installed packages for solving issues.
  - When looking for solutions and packages, focus on packages and code that are:
    - Well maintained
    - Popular
    - Well documented
    - Lightweight
    - Compatible with existing codebase and packages
    - Have minimal dependencies
    - Look up on github for open source projects that have some of the functionality we are trying to implement.

7. After completion:
  - Check if the created code needs to be refactored for easy to maintenance and readability.
  - Make sure we have clean code that is easy to debug and maintain.
  - Add comments and notes needed to understand the code and use of it.
