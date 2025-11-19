/**
 * Test suite for cleanContentForSave function
 * Tests removal of diagnostic and diff decorations from markdown content
 */

/**
 * Clean HTML/markdown content by removing diagnostic and diff decoration artifacts
 * This is a copy of the function from main.ts for testing purposes
 */
function cleanContentForSave(content) {
  if (!content) return content;

  // Remove diagnostic decoration spans and attributes
  let cleaned = content;
  
  // Remove diagnostic severity class spans (e.g., vscode-diagnostic-error-underline)
  // Handles class attribute anywhere in the span tag and diagnostic class anywhere in the class list
  // Apply multiple times to handle nested spans
  let prevCleaned = '';
  while (prevCleaned !== cleaned) {
    prevCleaned = cleaned;
    cleaned = cleaned.replace(/<span\s+(?:[^>]*\s+)?class="[^"]*\bvscode-diagnostic-[^"\s]*[^"]*"[^>]*>(.*?)<\/span>/g, '$1');
  }
  
  // Remove diagnostic source attributes
  cleaned = cleaned.replace(/\s+data-diagnostic-source="[^"]*"/g, '');
  
  // Remove diff decoration spans (added, removed, modified)
  // Handles class attribute anywhere in the span tag and diff class anywhere in the class list
  // Apply multiple times to handle nested spans
  prevCleaned = '';
  while (prevCleaned !== cleaned) {
    prevCleaned = cleaned;
    cleaned = cleaned.replace(/<span\s+(?:[^>]*\s+)?class="[^"]*\bvscode-diff-(?:added|removed|modified)\b[^"]*"[^>]*>(.*?)<\/span>/g, '$1');
  }
  
  // Remove lightbulb emoji characters
  cleaned = cleaned.replace(/💡/g, '');
  
  // Remove any inline styles added by decorations
  cleaned = cleaned.replace(/\s+style="[^"]*(?:text-decoration|background-color|border-bottom)[^"]*"/g, '');
  
  // Remove diff spacer block markers
  cleaned = cleaned.replace(/<!--\s*vscode-diff-spacer:\s*\d+\s*-->/g, '');
  
  // Remove any empty spans that might be left over
  cleaned = cleaned.replace(/<span><\/span>/g, '');
  
  return cleaned;
}

// Test framework functions
const tests = [];
let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
  tests.push({ description, fn });
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function runTests() {
  console.log('\n=== Running cleanContentForSave Tests ===\n');
  
  tests.forEach(({ description, fn }) => {
    try {
      fn();
      testsPassed++;
      console.log(`✓ ${description}`);
    } catch (error) {
      testsFailed++;
      console.error(`✗ ${description}`);
      console.error(`  ${error.message}`);
    }
  });
  
  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log(`Total: ${tests.length}`);
  
  if (testsFailed > 0) {
    process.exit(1);
  }
}

// ========================================
// Test Cases: Diagnostic Spans
// ========================================

test('removes diagnostic span with single class', () => {
  const input = '<span class="vscode-diagnostic-error">error text</span>';
  const expected = 'error text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diagnostic span with error-underline class', () => {
  const input = '<span class="vscode-diagnostic-error-underline">error text</span>';
  const expected = 'error text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diagnostic span with warning class', () => {
  const input = '<span class="vscode-diagnostic-warning-underline">warning text</span>';
  const expected = 'warning text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diagnostic span with class not as first attribute', () => {
  const input = '<span id="test" class="vscode-diagnostic-error" data-id="123">error text</span>';
  const expected = 'error text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diagnostic span with multiple classes where diagnostic is first', () => {
  const input = '<span class="vscode-diagnostic-error other-class another-class">error text</span>';
  const expected = 'error text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diagnostic span with multiple classes where diagnostic is in middle', () => {
  const input = '<span class="some-class vscode-diagnostic-warning-underline another-class">warning text</span>';
  const expected = 'warning text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diagnostic span with multiple classes where diagnostic is last', () => {
  const input = '<span class="class-one class-two vscode-diagnostic-info">info text</span>';
  const expected = 'info text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes multiple diagnostic spans in one line', () => {
  const input = 'Text <span class="vscode-diagnostic-error">error1</span> middle <span class="vscode-diagnostic-warning">warn1</span> end';
  const expected = 'Text error1 middle warn1 end';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes nested diagnostic spans', () => {
  const input = '<span class="vscode-diagnostic-error">outer <span class="vscode-diagnostic-warning">inner</span> text</span>';
  const expected = 'outer inner text';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Diff Decoration Spans
// ========================================

test('removes diff added span', () => {
  const input = '<span class="vscode-diff-added">added text</span>';
  const expected = 'added text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diff removed span', () => {
  const input = '<span class="vscode-diff-removed">removed text</span>';
  const expected = 'removed text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diff modified span', () => {
  const input = '<span class="vscode-diff-modified">modified text</span>';
  const expected = 'modified text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diff span with class not as first attribute', () => {
  const input = '<span data-line="5" class="vscode-diff-added" id="test">added text</span>';
  const expected = 'added text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diff span with multiple classes', () => {
  const input = '<span class="highlight vscode-diff-modified selection">modified text</span>';
  const expected = 'modified text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes multiple different diff spans', () => {
  const input = '<span class="vscode-diff-added">add</span> <span class="vscode-diff-removed">rem</span> <span class="vscode-diff-modified">mod</span>';
  const expected = 'add rem mod';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Data Attributes
// ========================================

test('removes data-diagnostic-source attribute', () => {
  const input = '<div data-diagnostic-source="markdownlint">text</div>';
  const expected = '<div>text</div>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes data-diagnostic-source from span with multiple attributes', () => {
  const input = '<span id="test" data-diagnostic-source="custom" class="highlight">text</span>';
  const expected = '<span id="test" class="highlight">text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes data-diagnostic-source as first attribute', () => {
  const input = '<div data-diagnostic-source="eslint" id="main" class="error">text</div>';
  const expected = '<div id="main" class="error">text</div>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes data-diagnostic-source as last attribute', () => {
  const input = '<span class="error" id="test" data-diagnostic-source="custom">text</span>';
  const expected = '<span class="error" id="test">text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Inline Styles
// ========================================

test('removes style with text-decoration', () => {
  const input = '<span style="text-decoration: underline wavy red;">text</span>';
  const expected = '<span>text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes style with background-color', () => {
  const input = '<span style="background-color: yellow;">text</span>';
  const expected = '<span>text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes style with border-bottom', () => {
  const input = '<span style="border-bottom: 2px solid red;">text</span>';
  const expected = '<span>text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes style with multiple decoration properties', () => {
  const input = '<span style="text-decoration: underline; background-color: yellow; border-bottom: 1px solid;">text</span>';
  const expected = '<span>text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes style attribute not as first attribute', () => {
  const input = '<span class="highlight" id="test" style="background-color: red;">text</span>';
  const expected = '<span class="highlight" id="test">text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Lightbulb Emoji
// ========================================

test('removes lightbulb emoji from text', () => {
  const input = '💡 This is a suggestion';
  const expected = ' This is a suggestion';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes multiple lightbulb emojis', () => {
  const input = '💡 First 💡 Second 💡 Third';
  const expected = ' First  Second  Third';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes lightbulb emoji inside spans', () => {
  const input = '<span class="test">💡 Fix this</span>';
  const expected = '<span class="test"> Fix this</span>';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Diff Spacer Comments
// ========================================

test('removes diff spacer comment', () => {
  const input = '<!-- vscode-diff-spacer: 5 -->';
  const expected = '';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes diff spacer comment with different line numbers', () => {
  const input = 'text <!-- vscode-diff-spacer: 123 --> more text';
  const expected = 'text  more text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes multiple diff spacer comments', () => {
  const input = '<!-- vscode-diff-spacer: 1 --> text <!-- vscode-diff-spacer: 99 -->';
  const expected = ' text ';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Empty Spans
// ========================================

test('removes empty spans', () => {
  const input = 'text <span></span> more text';
  const expected = 'text  more text';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes multiple empty spans', () => {
  const input = '<span></span><span></span>text<span></span>';
  const expected = 'text';
  assertEquals(cleanContentForSave(input), expected);
});

// ========================================
// Test Cases: Complex Real-World Scenarios
// ========================================

test('handles complex markdown with multiple decoration types', () => {
  const input = `# Heading
<span class="vscode-diagnostic-error-underline" data-diagnostic-source="markdownlint">Error text</span>
Normal text 💡
<span class="vscode-diff-added" style="background-color: green;">Added line</span>
<!-- vscode-diff-spacer: 3 -->
<span class="vscode-diff-removed">Removed line</span>`;
  
  const expected = `# Heading
Error text
Normal text 
Added line

Removed line`;
  
  assertEquals(cleanContentForSave(input), expected);
});

test('preserves non-diagnostic spans', () => {
  const input = '<span class="user-highlight">important</span> text <span class="custom-class">more</span>';
  const expected = '<span class="user-highlight">important</span> text <span class="custom-class">more</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('preserves spans with partial vscode class names that are not diagnostics', () => {
  const input = '<span class="my-vscode-theme">text</span>';
  const expected = '<span class="my-vscode-theme">text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('handles content with code blocks and decorations', () => {
  const input = `\`\`\`javascript
<span class="vscode-diagnostic-warning">const x = 1;</span>
console.log(x);
\`\`\``;
  
  const expected = `\`\`\`javascript
const x = 1;
console.log(x);
\`\`\``;
  
  assertEquals(cleanContentForSave(input), expected);
});

test('handles mixed diagnostic and diff decorations on same line', () => {
  const input = '<span class="vscode-diff-modified"><span class="vscode-diagnostic-error">error in diff</span></span>';
  const expected = 'error in diff';
  assertEquals(cleanContentForSave(input), expected);
});

test('preserves markdown links with decorations', () => {
  const input = '[<span class="vscode-diagnostic-warning">link text</span>](https://example.com)';
  const expected = '[link text](https://example.com)';
  assertEquals(cleanContentForSave(input), expected);
});

test('handles empty or null input', () => {
  assertEquals(cleanContentForSave(''), '');
  assertEquals(cleanContentForSave(null), null);
  assertEquals(cleanContentForSave(undefined), undefined);
});

test('handles content with only whitespace', () => {
  const input = '   \n\t  ';
  const expected = '   \n\t  ';
  assertEquals(cleanContentForSave(input), expected);
});

test('handles very long class attribute with diagnostic class in middle', () => {
  const input = '<span class="class1 class2 class3 class4 vscode-diagnostic-error class5 class6 class7" id="test" data-foo="bar">text</span>';
  const expected = 'text';
  assertEquals(cleanContentForSave(input), expected);
});

test('handles span with diagnostic class and style attribute', () => {
  const input = '<span class="vscode-diagnostic-error-underline" style="text-decoration: underline wavy red; color: red;">error</span>';
  const expected = 'error';
  assertEquals(cleanContentForSave(input), expected);
});

test('preserves data attributes that are not diagnostic-related', () => {
  const input = '<div data-id="123" data-value="test">content</div>';
  const expected = '<div data-id="123" data-value="test">content</div>';
  assertEquals(cleanContentForSave(input), expected);
});

test('removes only decoration-related styles, preserves others', () => {
  const input = '<span style="color: red; font-weight: bold;">text</span>';
  const expected = '<span style="color: red; font-weight: bold;">text</span>';
  assertEquals(cleanContentForSave(input), expected);
});

test('handles unicode and special characters with decorations', () => {
  const input = '<span class="vscode-diagnostic-error">Héllo Wörld 你好 🌍</span>';
  const expected = 'Héllo Wörld 你好 🌍';
  assertEquals(cleanContentForSave(input), expected);
});

test('handles deeply nested decorations', () => {
  const input = '<div><p><span class="vscode-diff-added"><span class="vscode-diagnostic-warning">nested</span></span></p></div>';
  const expected = '<div><p>nested</p></div>';
  assertEquals(cleanContentForSave(input), expected);
});

// Run all tests
runTests();
