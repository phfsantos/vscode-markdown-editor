# Habit Tracker Widget Demo

A monthly habit tracker inspired by wigggle-ui productivity-04.tsx. Press the check button to mark today complete; the small undo button next to it unmarks today. Completed days are saved back into the code block as `completedDates`.

## Basic Usage

```widget
type: habit-tracker
title: Read 20 minutes
```

## Small Size (Default)

```widget
type: habit-tracker
title: Meditate
size: sm
---
data: {"completedDates": ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-06", "2026-10-07"]}
```

## Medium Size

Shows the current streak and month total next to the grid.

```widget
type: habit-tracker
title: Workout
size: md
---
data: {"completedDates": ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]}
```

## Large Size

Day numbers in the grid, plus current and best streaks.

```widget
type: habit-tracker
title: No sugar
size: lg
---
data: {"completedDates": ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09", "2026-10-10", "2026-10-20", "2026-10-21"]}
```

## Without Streak Stats

```widget
type: habit-tracker
title: Journal
size: md
showStreak: false
---
data: {"completedDates": ["2026-10-10", "2026-10-11"]}
```

## Multiple Instances

Each habit keeps its own dates.

```widget
type: habit-tracker
title: Water plants
```

```widget
type: habit-tracker
title: Stretch
```
