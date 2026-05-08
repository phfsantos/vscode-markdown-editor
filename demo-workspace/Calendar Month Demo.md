# Calendar Month Widget Demo

This demo showcases the Calendar Month Widget - a full month calendar view with day grid and navigation, inspired by wigggle-ui calendar-03 and calendar-04 patterns.

## Basic Usage

```widget
type: calendar-month
```

## Small Size (Default)

```widget
type: calendar-month
size: sm
showNavigation: true
showWeekdays: true
```

## Medium Size

```widget
type: calendar-month
size: md
showNavigation: true
showWeekdays: true
```

## Large Size

```widget
type: calendar-month
size: lg
showNavigation: true
showWeekdays: true
```

## Week Starting on Monday

```widget
type: calendar-month
size: sm
weekStartsOnMonday: true
showNavigation: true
showWeekdays: true
```

## Without Navigation Controls

```widget
type: calendar-month
size: sm
showNavigation: false
showWeekdays: true
```

## Without Weekday Headers

```widget
type: calendar-month
size: sm
showNavigation: true
showWeekdays: false
```

## Minimal Design

```widget
type: calendar-month
size: sm
design: minimal
showNavigation: true
showWeekdays: true
```

## Glass Design

```widget
type: calendar-month
size: lg
design: glass
showNavigation: true
showWeekdays: true
```

## Spanish Locale

```widget
type: calendar-month
size: sm
locale: es-ES
showNavigation: true
showWeekdays: true
```

## Portuguese (Brazil) Locale

```widget
type: calendar-month
size: sm
locale: pt-BR
weekStartsOnMonday: true
showNavigation: true
showWeekdays: true
```

## Features

- **Full Month Grid**: Displays all days of the current month in a 7-column grid
- **Current Day Highlighting**: Today's date is highlighted with a badge
- **Month Navigation**: Navigate between months with prev/next buttons
- **Week Start Configuration**: Choose between Sunday or Monday as the first day of the week
- **Locale Support**: Internationalization for month names and weekday labels
- **Size Variants**: Small, Medium, and Large sizes
- **Design Variants**: Default, Minimal, and Glass designs
- **Settings Panel**: Configure all options via the settings gear icon

