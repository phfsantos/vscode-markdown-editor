# Calendar Events Widget Demo

This demo showcases the **Calendar Events Widget** which displays calendar events for a specific day with support for external calendar integration.

---

## Features

- **Event Display**: Shows events with time, title, and color-coded borders
- **Size Variants**: Small (events only), Medium (with mini calendar), Large (full featured)
- **Custom Events**: Receives events via DOM custom events (for Google/Outlook integration)
- **Video Calls**: Support for video call indicators and join buttons
- **External Links**: Open events in browser with link support
- **Mini Calendar**: Navigate between days with event indicator dots

---

## Small Size (Events Only)

<widget
  type="calendar-events"
  size="sm"
  showAddButton="true"
  showEventCount="true"
  locale="en-US"
/>

---

## Medium Size (With Mini Calendar)

<widget
  type="calendar-events"
  size="md"
  title="Today's Schedule"
  showAddButton="true"
  showMiniCalendar="true"
  showEventCount="true"
  locale="en-US"
/>

---

## Large Size (Full Featured)

<widget
  type="calendar-events"
  size="lg"
  title="Daily Agenda"
  showAddButton="true"
  showMiniCalendar="true"
  showEventCount="true"
  maxEvents="0"
  locale="en-US"
/>

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `sm` \| `md` \| `lg` | `sm` | Widget size variant |
| `title` | string | `''` | Widget header title |
| `locale` | string | `en-US` | Date/time locale |
| `showAddButton` | boolean | `true` | Show add event button |
| `showMiniCalendar` | boolean | `true` | Show mini calendar (md/lg) |
| `showEventCount` | boolean | `true` | Show event count badge |
| `maxEvents` | number | `0` | Max events to display (0 = all) |
| `eventChannel` | string | `calendar-events` | Custom event channel ID |

---

## Receiving Events via Custom Events

The widget listens for events on the configured `eventChannel`. You can send events to the widget using:

```javascript
// Set events
window.dispatchEvent(new CustomEvent('calendar-events', {
  detail: {
    action: 'set',
    events: [
      { id: '1', title: 'Meeting', time: '9:00 AM', color: 'blue', hasVideo: true },
      { id: '2', title: 'Lunch', time: '12:00 PM', color: 'green' }
    ]
  }
}));

// Add events
window.dispatchEvent(new CustomEvent('calendar-events', {
  detail: {
    action: 'add',
    events: [{ id: '3', title: 'Call', time: '3:00 PM', color: 'yellow' }]
  }
}));

// Remove event
window.dispatchEvent(new CustomEvent('calendar-events', {
  detail: { action: 'remove', eventId: '1' }
}));

// Clear all events
window.dispatchEvent(new CustomEvent('calendar-events', {
  detail: { action: 'clear' }
}));
```

---

## Event Object Structure

```typescript
interface CalendarEvent {
  id: string;           // Unique identifier
  title: string;        // Event title
  time: string;         // Display time (e.g., "9:00 AM")
  startTime?: string;   // ISO date string for sorting
  endTime?: string;     // ISO date string
  color?: string;       // Border color (red, blue, green, yellow, etc.)
  hasVideo?: boolean;   // Show video call button
  link?: string;        // External link URL
  description?: string; // Event description
  location?: string;    // Event location
  source?: string;      // 'google' | 'outlook' | 'local'
  allDay?: boolean;     // All-day event
}
```

---

## Future Integration

This widget is designed to integrate with VS Code authentication for Google and Outlook calendars. The editor can fetch calendar events and dispatch them to the widget via custom events.

---

## Color Presets

Available color presets for event borders:
- `red` - #ef4444
- `orange` - #f97316
- `yellow` - #eab308
- `green` - #22c55e
- `blue` - #3b82f6
- `purple` - #a855f7
- `pink` - #ec4899
- `teal` - #14b8a6

Or use any valid CSS color value.

