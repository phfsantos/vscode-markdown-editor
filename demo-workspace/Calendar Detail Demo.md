# Calendar Detail Widget Demo

The Calendar Detail widget displays today's date with more detail than the simple calendar - showing full weekday name, large date number, full month name, and year badge.

## Default Calendar Detail

```widget
{
  "type": "calendar-detail"
}
```

## Medium Size with All Options

```widget
{
  "type": "calendar-detail",
  "size": "md",
  "showWeekday": true,
  "showMonth": true,
  "showYear": true
}
```

## Large Size - Glass Design

```widget
{
  "type": "calendar-detail",
  "size": "lg",
  "design": "glass",
  "showWeekday": true,
  "showMonth": true,
  "showYear": true
}
```

## Minimal - Date Only

```widget
{
  "type": "calendar-detail",
  "size": "sm",
  "design": "minimal",
  "showWeekday": false,
  "showMonth": false,
  "showYear": false
}
```

## Portuguese Locale

```widget
{
  "type": "calendar-detail",
  "size": "md",
  "locale": "pt-BR",
  "showWeekday": true,
  "showMonth": true,
  "showYear": true
}
```

## Comparison: Simple vs Detail

### Simple Calendar (compact)

```widget
{
  "type": "calendar",
  "size": "sm"
}
```

### Calendar Detail (full information)

```widget
{
  "type": "calendar-detail",
  "size": "sm"
}
```

## Features

- **Full Weekday Name**: Displays "Sunday", "Monday", etc. (configurable)
- **Large Date**: Prominent display of the date number
- **Full Month Name**: Displays "January", "December", etc. (configurable)
- **Year Badge**: Shows year in an outlined badge (configurable)
- **Size Variants**: Small, Medium, Large
- **Design Variants**: Default, Minimal, Glass
- **Locale Support**: Multiple languages (English, Portuguese, Spanish, French, German, Japanese, Chinese)
- **Settings Panel**: Click ⚙️ to configure options

## Settings

Click the ⚙️ icon in the top-right corner of any calendar detail widget to open the settings panel where you can:

1. Change the size (sm/md/lg)
2. Change the design (default/minimal/glass)
3. Show/hide weekday
4. Show/hide month
5. Show/hide year badge
6. Change language/locale

