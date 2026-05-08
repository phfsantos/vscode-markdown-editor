# Timer Widget Demo

A countdown timer widget with start/pause/reset controls, inspired by wigggle-ui clock-11.tsx.

## Basic Usage

```widget
type: timer
title: Focus Timer
```

## Small Size (Default)

```widget
type: timer
title: Pomodoro
size: sm
initialMinutes: 25
```

## Medium Size

```widget
type: timer
title: Break Timer
size: md
initialMinutes: 5
```

## Large Size

```widget
type: timer
title: Deep Work
size: lg
initialMinutes: 45
```

## Custom Configuration

### Short Timer (1-10 minutes range)

```widget
type: timer
title: Quick Timer
size: sm
initialMinutes: 3
minMinutes: 1
maxMinutes: 10
```

### Long Timer (up to 2 hours)

```widget
type: timer
title: Extended Session
size: md
initialMinutes: 60
maxMinutes: 120
```

## Design Variants

### Minimal Design

```widget
type: timer
title: Minimal Timer
size: sm
design: minimal
initialMinutes: 10
```

### Glass Design

```widget
type: timer
title: Glass Timer
size: sm
design: glass
initialMinutes: 15
```

## Without Minute Controls

```widget
type: timer
title: Fixed Timer
size: sm
initialMinutes: 10
showMinuteControls: false
```

## With Persisted State

This timer saves its state (time remaining and running status) to the code block:

```widget
type: timer
title: Persistent Timer
size: md
initialMinutes: 5
---
timeLeft: 180
isRunning: false
```

## Multiple Timers

You can have multiple independent timers:

```widget
type: timer
title: Timer 1
size: sm
initialMinutes: 5
```

```widget
type: timer
title: Timer 2
size: sm
initialMinutes: 10
```

```widget
type: timer
title: Timer 3
size: sm
initialMinutes: 15
```

## Features

- ➕ Add/subtract minutes with +/- buttons (when not running)
- ▶️ Start/pause the countdown with the play/pause button
- 🔄 Reset timer to initial value with the reset button
- ⚙️ Settings panel for customization
- 💾 Persistent state - time and running status saved to code block
- 🎨 Multiple design variants (default, minimal, glass)
- 📐 Three size options (sm, md, lg)
- ✅ "Time's up!" notification when countdown completes

