# Test Markdown Document

This document contains various markdown elements to test the new diagnostic and enhancement features.

## Broken Links Section

Here's a [broken link](http://this-does-not-exist-12345.com) that should show a warning.

And here's a [local broken link](./non-existent-file.md).

## Images Section

![](./image-without-alt-text.png)

![Image with alt text](./good-image.png)

## Table Section

| Name Age |
| John | 25 |
| Jane | 30

| Name | Age | City |
|------|-----|------|
| John | 25  | NYC  |

## Emphasis and Code

This is *emphasized text* and this is **strong text**.

Here's some `inline code` and here's a link to [Google](https://google.com).

## Very Long Line That Exceeds 120 Characters And Should Show A Warning About Being Too Long For Readability And Good Markdown Practices

## Test Missing H1

Some content here without proper heading structure.

### Skipped Heading Level

This heading skips from H2 to H4, which should show a diagnostic warning.

## Code Block

```javascript
console.log("This should be properly highlighted");
```

## Trailing Whitespace Lines   
This line has trailing spaces that should be detected.