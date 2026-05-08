# Clock Widget Demo

This document demonstrates all the clock widget face options.

## Digital Clock (Default)

Basic digital clock with day of week:

```widget
type: clock
showDayOfWeek: true
showSeconds: true
format: 12h
size: sm
```

## Analog Clock (Plain)

Simple analog clock with hour, minute, and second hands:

```widget
type: clock
face: analog
size: sm
```

## Analog Clock with Numbers

Analog clock with Arabic numerals (1-12):

```widget
type: clock
face: analog-numbers
size: md
```

## Analog Clock with Roman Numerals

Classic analog clock with Roman numerals (XII, I, II, III...):

```widget
type: clock
face: analog-roman
size: md
```

## Multi-Zone Clock (2 Zones)

Two timezone list with day/night icons:

```widget
type: clock
face: multizone-2
format: 12h
timezones:
  - label: New York
    timezone: America/New_York
  - label: London
    timezone: Europe/London
```

## Multi-Zone Clock (4 Zones - List)

Four timezone list layout:

```widget
type: clock
face: multizone-4-list
format: 24h
timezones:
  - label: New York
    timezone: America/New_York
  - label: London
    timezone: Europe/London
  - label: Tokyo
    timezone: Asia/Tokyo
  - label: Sydney
    timezone: Australia/Sydney
```

## Multi-Zone Clock (4 Zones - Grid)

Four timezone 2x2 grid layout:

```widget
type: clock
face: multizone-4-grid
format: 12h
size: md
timezones:
  - label: Los Angeles
    timezone: America/Los_Angeles
  - label: Paris
    timezone: Europe/Paris
  - label: Dubai
    timezone: Asia/Dubai
  - label: Singapore
    timezone: Asia/Singapore
```

## Configuration Options

### Face Types
- `digital` - Standard digital clock (default)
- `analog` - Plain analog clock
- `analog-numbers` - Analog with Arabic numerals
- `analog-roman` - Analog with Roman numerals
- `multizone-2` - Two timezone list
- `multizone-4-list` - Four timezone list
- `multizone-4-grid` - Four timezone 2x2 grid

### Digital Clock Options
- `format`: `12h` or `24h`
- `showSeconds`: `true` or `false`
- `showDate`: `true` or `false`
- `showDayOfWeek`: `true` or `false` (shows "Monday", "Tuesday", etc.)

### Multi-Zone Options
- `timezones`: Array of `{ label: string, timezone: string }`
- `timezone` uses IANA timezone identifiers like:
  - `America/New_York`
  - `Europe/London`
  - `Asia/Tokyo`
  - `Australia/Sydney`
  - `America/Los_Angeles`
  - `Europe/Paris`

### Size Options
- `sm` - Small (180x180)
- `md` - Medium (360x180)
- `lg` - Large (360x360)
