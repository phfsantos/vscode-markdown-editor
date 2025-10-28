# Embed Preview Overlay Fix

## Summary
Fixed the `vscode-embed-preview-overlay` component to eliminate double scrollbars, improve button styling consistency with sidebar, and enhance usability with icon buttons and tooltips.

## Issues Fixed

### 1. Double Scrollbar Problem
**Problem:** The overlay had `overflow: auto` on the main container AND on nested `<pre>` elements, causing two scrollbars to appear.

**Solution:** 
- Restructured overlay to use flexbox layout with dedicated header and content areas
- Removed `overflow: auto` from main container
- Added `.embed-content` div with `overflow: auto` and `flex: 1` for scrollable content
- Removed `max-height` and `overflow` from `<pre>` elements inside the overlay

### 2. Button Styling Inconsistency
**Problem:** Buttons used custom styling that didn't match the sidebar's button design.

**Solution:**
- Replaced text buttons with icon buttons matching sidebar styling
- Used VS Code codicons for visual consistency: `$(close)`, `$(go-to-file)`, `$(cloud-download)`
- Applied same hover effects and transitions as sidebar buttons

### 3. Button Placement and Usability
**Problem:** Buttons were scattered at the bottom of content, making them hard to find.

**Solution:**
- Created dedicated header bar at the top with title and action buttons
- All buttons now appear as icons in the top-right corner
- Added tooltips to icon buttons to explain their function

## Changes Made

### CSS Changes (`media-src/src/main.css`)

1. **Main Overlay Structure:**
   - Changed to `display: flex; flex-direction: column`
   - Removed `overflow: auto` and `padding` from main container
   - Added `max-height: 60vh` constraint

2. **New Header Section:**
   ```css
   .embed-header {
     display: flex;
     align-items: center;
     justify-content: space-between;
     padding: 8px 12px;
     border-bottom: 1px solid ...;
   }
   ```

3. **Icon Button Styling:**
   ```css
   .icon-btn {
     background: none;
     border: none;
     padding: 4px;
     opacity: 0.7;
     transition: opacity 0.2s, background-color 0.2s;
   }
   ```

4. **Tooltip Implementation:**
   - Used `::after` pseudo-element with `data-tooltip` attribute
   - Appears on hover below the button
   - Matches VS Code's hover widget styling

5. **Scrollable Content Area:**
   ```css
   .embed-content {
     overflow: auto;
     padding: 12px;
     flex: 1;
     min-height: 0;
   }
   ```

### JavaScript Changes (`media-src/src/main.ts`)

1. **Restructured DOM Creation:**
   - Header div with title and actions
   - Icon buttons with tooltips
   - Content div for scrollable content

2. **Icon Buttons:**
   - **Close Button:** `$(close)` - Always visible, closes the overlay
   - **Open Button:** `$(go-to-file)` - Only if path is available, opens file in VS Code
   - **Download Button:** `$(cloud-download)` - Only if dataUrl is available, downloads the file

3. **Simplified Inline Styles:**
   - Removed all inline styling from main container (now uses CSS classes)
   - Removed bottom button rows
   - Content structure is cleaner and more maintainable

## Testing Checklist

- [x] Build completes without errors
- [ ] Single scrollbar appears only in content area
- [ ] Icon buttons appear at top-right of overlay
- [ ] Tooltips show on hover over icon buttons
- [ ] Close button removes the overlay
- [ ] Open button opens file in VS Code (when path available)
- [ ] Download button downloads file (when dataUrl available)
- [ ] Button styling matches sidebar buttons
- [ ] Overlay is responsive and doesn't overflow viewport

## Visual Changes

### Before:
- Buttons with text at bottom: "Close", "Open", "Download"
- Double scrollbars (one on overlay, one on pre elements)
- Generic button styling
- No tooltips

### After:
- Icon buttons at top-right with tooltips
- Single scrollbar in content area only
- Consistent with sidebar button design
- Clear visual hierarchy with header/content separation

## Technical Notes

- Uses VS Code codicons for icons (requires codicon font to be loaded)
- Flexbox layout prevents double scrollbar issues
- Tooltip positioning uses `::after` pseudo-element for performance
- All styles use VS Code CSS variables for theme integration
- Icon buttons match the pattern used in `sidebar.css` for consistency

