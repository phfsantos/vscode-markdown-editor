# Stopwatch Widget Demo

A stopwatch widget based on wigggle-ui clock-12.tsx with elapsed time tracking, lap times, and analog visualization.

## Basic Usage

```widget
type: stopwatch
title: My Stopwatch
---
elapsedTime: 0
isRunning: false
laps: []
```

## Small Size (Default)

```widget
type: stopwatch
title: Quick Timer
size: sm
showAnalog: true
showLaps: true
---
elapsedTime: 0
isRunning: false
laps: []
```

## Medium Size

```widget
type: stopwatch
title: Workout Timer
size: md
showAnalog: true
showLaps: true
maxLaps: 15
---
elapsedTime: 0
isRunning: false
laps: []
```

## Large Size

```widget
type: stopwatch
title: Race Timer
size: lg
showAnalog: true
showLaps: true
maxLaps: 20
---
elapsedTime: 0
isRunning: false
laps: []
```

## Digital Only (No Analog)

```widget
type: stopwatch
title: Simple Timer
size: md
showAnalog: false
showLaps: false
---
elapsedTime: 0
isRunning: false
laps: []
```

## With Lap Times Disabled

```widget
type: stopwatch
title: Basic Stopwatch
size: sm
showAnalog: true
showLaps: false
---
elapsedTime: 0
isRunning: false
laps: []
```

## Minimal Design

```widget
type: stopwatch
title: Minimal
size: md
design: minimal
showAnalog: true
showLaps: true
---
elapsedTime: 0
isRunning: false
laps: []
```

## Glass Design

```widget
type: stopwatch
title: Glass Style
size: md
design: glass
showAnalog: true
showLaps: true
---
elapsedTime: 0
isRunning: false
laps: []
```

## Features

- **Start/Pause**: Click the play/pause button to control the stopwatch
- **Reset**: Click the reset button to clear the timer and all laps
- **Lap Times**: Click the lap button while running to record lap times
- **Analog Display**: Visual circular clock face with second hand
- **Digital Display**: Precise time display with milliseconds
- **Settings Panel**: Customize title, size, analog/lap visibility, and design
- **State Persistence**: Elapsed time and lap times are saved to the code block

## Usage Tips

1. Press play to start the stopwatch
2. Press pause to stop without resetting
3. Press the lap button (clock icon) to record split times
4. Press reset to clear everything
5. Click the gear icon to customize settings

