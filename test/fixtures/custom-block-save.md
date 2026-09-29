# Custom block save fixture

Before the custom blocks.

```mermaid
flowchart TD
  START["Unicode start: café ☕"] --> MIDDLE{"Keep blank lines?"}
  HTML["<br> <br/> </br> <tag attr=\"café ☕\">終わり</tag>"] --> FINISH["sentinel"]

  MIDDLE -->|yes| FINISH["終わり"]
```

Between the custom blocks.

```kanban-board
<!-- board: fixture-board -->
<!-- file: assets/fixture-board.json -->
<board-item data-label="literal <br/>">blank</board-item>
```

```table
<!-- table: fixture-table -->
<!-- file: assets/fixture-table.json -->
```

After the custom blocks.
