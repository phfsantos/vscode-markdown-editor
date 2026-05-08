# Single Alarm Widget Demo

A simple alarm widget with wheel picker interface, inspired by wigggle-ui clock-13.tsx.

## Basic Usage

```widget
type: single-alarm
title: My Alarm
---
hour: 9
minute: 0
meridiem: AM
enabled: false
triggered: false
```

## Small Size (Default)

```widget
type: single-alarm
title: Wake Up
size: sm
---
hour: 7
minute: 30
meridiem: AM
enabled: true
```

## Medium Size

```widget
type: single-alarm
title: Meeting Reminder
size: md
---
hour: 10
minute: 0
meridiem: AM
enabled: false
```

## Large Size

```widget
type: single-alarm
title: Lunch Break
size: lg
---
hour: 12
minute: 30
meridiem: PM
enabled: true
```

## 24-Hour Format

```widget
type: single-alarm
title: 24h Alarm
use24Hour: true
---
hour: 14
minute: 45
meridiem: PM
enabled: false
```

## Glass Design

```widget
type: single-alarm
title: Glass Style
design: glass
size: md
---
hour: 8
minute: 15
meridiem: AM
enabled: false
```

## Minimal Design

```widget
type: single-alarm
title: Minimal
design: minimal
size: md
---
hour: 6
minute: 0
meridiem: AM
enabled: false
```

## Features

- **Wheel Picker Interface**: Use up/down arrows to adjust hours, minutes, and AM/PM
- **Single Alarm Focus**: Simple one-alarm interface instead of managing multiple alarms
- **Confirm/Cancel Buttons**: Click checkmark to enable alarm, X to disable
- **Sound Notification**: Plays sound when alarm triggers
- **VS Code Notification**: Shows notification in VS Code when alarm goes off
- **Auto Reset**: Triggered state resets at midnight
- **Size Variants**: sm (small), md (medium), lg (large)
- **Design Variants**: default, minimal, glass
- **24-Hour Support**: Toggle between 12h and 24h format in settings
- **Persistent State**: Alarm settings saved to code block

## Comparison with Alarm Widget

| Feature | Single Alarm | Alarm Widget |
|---------|--------------|--------------|
| Number of alarms | 1 | Multiple |
| Interface | Wheel picker | List with toggles |
| Complexity | Simple | More features |
| Best for | Quick one-time alarm | Managing schedule |
