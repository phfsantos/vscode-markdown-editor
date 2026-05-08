# Alarm Widget Demo

This page demonstrates the Alarm widget functionality.

## Basic Alarm Widget

```widget
type: alarm
title: Alarms
---
data: {"alarms": [{"id": "demo-1", "time": "07:00", "label": "Morning", "enabled": true}, {"id": "demo-2", "time": "12:30", "label": "Lunch Break", "enabled": true}, {"id": "demo-3", "time": "17:30", "label": "End of Day", "enabled": false}]}
```

## Small Size

```widget
type: alarm
title: Quick Alarms
size: sm
---
data: {"alarms": [{"id": "sm-1", "time": "09:00", "label": "Standup", "enabled": true}]}
```

## Medium Size

```widget
type: alarm
title: Daily Reminders
size: md
---
data: {"alarms": [{"id": "md-1", "time": "08:00", "label": "Start work", "enabled": true}, {"id": "md-2", "time": "12:00", "label": "Lunch", "enabled": true}, {"id": "md-3", "time": "15:00", "label": "Coffee break", "enabled": true}, {"id": "md-4", "time": "18:00", "label": "End work", "enabled": true}]}
```

## Large Size with 24-Hour Format

```widget
type: alarm
title: Schedule
size: lg
use24Hour: true
---
data: {"alarms": [{"id": "lg-1", "time": "06:30", "label": "Wake up", "enabled": true}, {"id": "lg-2", "time": "07:00", "label": "Exercise", "enabled": true}, {"id": "lg-3", "time": "08:30", "label": "Breakfast", "enabled": false}, {"id": "lg-4", "time": "14:00", "label": "Meeting", "enabled": true}]}
```

## Minimal Design

```widget
type: alarm
title: Focus Alarms
design: minimal
maxAlarms: 5
---
data: {"alarms": [{"id": "min-1", "time": "10:00", "label": "Focus session 1", "enabled": true}, {"id": "min-2", "time": "14:00", "label": "Focus session 2", "enabled": true}]}
```

## Glass Design

```widget
type: alarm
title: Notifications
design: glass
size: md
---
data: {"alarms": [{"id": "glass-1", "time": "09:30", "label": "Team sync", "enabled": true}, {"id": "glass-2", "time": "11:00", "label": "Review PR", "enabled": false}]}
```

## Empty Alarms (Test Adding)

```widget
type: alarm
title: My Alarms
---
data: {"alarms": []}
```

---

## Features to Test

1. **Toggle Alarms**: Click the switch to enable/disable alarms
2. **Add Alarm**: Click "Add Alarm" button to create new alarms
3. **Delete Alarm**: Click the trash icon to remove alarms
4. **Time Format**: Test 12-hour vs 24-hour format display
5. **Sound Notification**: When alarm triggers, you'll hear a sound
6. **VS Code Notification**: When alarm triggers, VS Code shows a warning notification
7. **Persistence**: Changes are automatically saved to the code block
8. **Settings**: Click the gear icon to adjust widget settings

## Notes

- Alarms check every 10 seconds if it's time to trigger
- Once triggered, alarms won't trigger again until the next day (midnight reset)
- The bell icon animates when an alarm is ringing
- Triggered alarms show with strikethrough text

