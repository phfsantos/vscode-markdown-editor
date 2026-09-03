import assert from 'assert';
import { test } from 'vitest';

import {
  cleanupLineNumberRoot,
  findLineNumberRoot,
  getLineNumberKeyboardTarget,
  getLineNumberTabIndex,
  getLineNumberStyles,
  getSelectedLineNumber,
  getLineNumberLayout,
  navigateToLineElement,
  shouldUpdateActiveLine,
} from '../packages/media/src/line-number-renderer';

class FakeElement {
  constructor(attrs = {}, children = []) {
    this.nodeType = 1;
    this._attrs = { ...attrs };
    this.childNodes = [];
    this.parentElement = null;
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name);
  }

  getAttribute(name) {
    return this.hasAttribute(name) ? this._attrs[name] : null;
  }
}

class FakeTextNode {
  constructor(text = '') {
    this.nodeType = 3;
    this.textContent = text;
    this.childNodes = [];
    this.parentElement = null;
  }
}

function element(attrs = {}, children = []) {
  return new FakeElement(attrs, children);
}

function text(value = '') {
  return new FakeTextNode(value);
}

function selection(focusNode, focusOffset = 0) {
  return {
    focusNode,
    focusOffset,
    rangeCount: 1,
    getRangeAt() {
      return {
        startContainer: focusNode,
        startOffset: focusOffset,
      };
    },
  };
}

function testReturnsLineNumberFromFocusedDescendant() {
  const textNode = text('Alpha');
  const line = element({ 'data-line-number-anchor': 'true', 'data-source-line': '4' }, [textNode]);
  const root = element({}, [line]);

  assert.strictEqual(getSelectedLineNumber(selection(textNode, 2), root), 4);
  console.log('✅ testReturnsLineNumberFromFocusedDescendant passed');
}

function testReturnsLineNumberFromFocusNodeItself() {
  const line = element({ 'data-line-number-anchor': 'true', 'data-source-line': '1' });
  const root = element({}, [line]);

  assert.strictEqual(getSelectedLineNumber(selection(line, 0), root), 1);
  console.log('✅ testReturnsLineNumberFromFocusNodeItself passed');
}

function testFallsForwardWhenSelectionContainerIsRootAtChildBoundary() {
  const first = element({ 'data-line-number-anchor': 'true', 'data-source-line': '0' }, [text('One')]);
  const second = element({ 'data-line-number-anchor': 'true', 'data-source-line': '1' }, [text('Two')]);
  const root = element({}, [first, second]);

  assert.strictEqual(getSelectedLineNumber(selection(root, 1), root), 1);
  console.log('✅ testFallsForwardWhenSelectionContainerIsRootAtChildBoundary passed');
}

function testFallsBackwardWhenSelectionOffsetIsAfterLastChild() {
  const first = element({ 'data-line-number-anchor': 'true', 'data-source-line': '0' }, [text('One')]);
  const second = element({ 'data-line-number-anchor': 'true', 'data-source-line': '1' }, [text('Two')]);
  const root = element({}, [first, second]);

  assert.strictEqual(getSelectedLineNumber(selection(root, 2), root), 1);
  console.log('✅ testFallsBackwardWhenSelectionOffsetIsAfterLastChild passed');
}

function testIgnoresAnchorsOutsideRoot() {
  const outsideText = text('Outside');
  const outsideLine = element({ 'data-line-number-anchor': 'true', 'data-source-line': '8' }, [outsideText]);
  const root = element({}, []);

  assert.strictEqual(getSelectedLineNumber(selection(outsideText, 0), root), null);
  console.log('✅ testIgnoresAnchorsOutsideRoot passed');
}

function testReturnsNullWithoutSelectionOrRoot() {
  assert.strictEqual(getSelectedLineNumber(null, null), null);
  assert.strictEqual(getSelectedLineNumber({ rangeCount: 0 }, element()), null);
  console.log('✅ testReturnsNullWithoutSelectionOrRoot passed');
}

function testLineNumberLayoutScalesWithDigits() {
  const small = getLineNumberLayout(9);
  const large = getLineNumberLayout(1200);

  assert.ok(small.gutterWidth >= 34);
  assert.ok(large.gutterWidth > small.gutterWidth);
  assert.ok(large.paddingLeft > small.paddingLeft);
  console.log('✅ testLineNumberLayoutScalesWithDigits passed');
}

function testShouldUpdateActiveLineWhenLineNumberChanges() {
  assert.strictEqual(shouldUpdateActiveLine(1, 2, {}, {}), true);
  console.log('✅ testShouldUpdateActiveLineWhenLineNumberChanges passed');
}

function testShouldUpdateActiveLineWhenElementChangesForSameLine() {
  const current = {};
  const next = {};
  assert.strictEqual(shouldUpdateActiveLine(3, 3, current, next), true);
  console.log('✅ testShouldUpdateActiveLineWhenElementChangesForSameLine passed');
}

function testShouldNotUpdateActiveLineWhenSelectionRemainsCleared() {
  assert.strictEqual(shouldUpdateActiveLine(null, null, null, null), false);
  console.log('✅ testShouldNotUpdateActiveLineWhenSelectionRemainsCleared passed');
}

function testNavigateToLineElementMovesCaretAndRevealsLine() {
  const calls = [];
  const root = {
    focus(options) {
      calls.push(['focus', options]);
    },
  };
  const line = {
    textContent: 'Target line',
    scrollIntoView(options) {
      calls.push(['scrollIntoView', options]);
    },
  };
  const range = {
    selectNodeContents(node) {
      calls.push(['selectNodeContents', node]);
    },
    collapse(toStart) {
      calls.push(['collapse', toStart]);
    },
  };
  const selectionApi = {
    removeAllRanges() {
      calls.push(['removeAllRanges']);
    },
    addRange(nextRange) {
      calls.push(['addRange', nextRange]);
    },
  };

  navigateToLineElement(root, line, selectionApi, () => range);

  assert.strictEqual(line.textContent, 'Target line', 'navigation must not mutate editor content');
  assert.deepStrictEqual(calls, [
    ['focus', { preventScroll: true }],
    ['selectNodeContents', line],
    ['collapse', true],
    ['removeAllRanges'],
    ['addRange', range],
    ['scrollIntoView', { block: 'center', behavior: 'smooth' }],
  ]);
  console.log('✅ testNavigateToLineElementMovesCaretAndRevealsLine passed');
}

function testFindLineNumberRootCoversSupportedVditorModes() {
  const irRoot = { mode: 'ir' };
  const wysiwygRoot = { mode: 'wysiwyg' };
  const sourceRoot = { mode: 'sv' };
  const createScope = (activeModes) => {
    const calls = [];
    return {
      calls,
      querySelector(selector) {
        calls.push(selector);
        if (selector.includes(',')) {
          const firstDocumentMatch = ['sv', 'wysiwyg', 'ir'].find((mode) => activeModes.includes(mode));
          return firstDocumentMatch === 'sv'
            ? sourceRoot
            : firstDocumentMatch === 'wysiwyg'
              ? wysiwygRoot
              : irRoot;
        }
      const rootsBySelector = new Map([
        ['.vditor-ir > .vditor-reset', activeModes.includes('ir') ? irRoot : null],
        ['.vditor-wysiwyg > .vditor-reset', activeModes.includes('wysiwyg') ? wysiwygRoot : null],
        ['.vditor-sv > .vditor-reset', activeModes.includes('sv') ? sourceRoot : null],
      ]);
        return rootsBySelector.get(selector) ?? null;
      },
    };
  };

  const allModes = createScope(['ir', 'wysiwyg', 'sv']);
  assert.strictEqual(findLineNumberRoot(allModes), irRoot);
  assert.deepStrictEqual(allModes.calls, ['.vditor-ir > .vditor-reset']);

  const alternateModes = createScope(['wysiwyg', 'sv']);
  assert.strictEqual(findLineNumberRoot(alternateModes), wysiwygRoot);
  assert.deepStrictEqual(alternateModes.calls, [
    '.vditor-ir > .vditor-reset',
    '.vditor-wysiwyg > .vditor-reset',
  ]);

  const sourceMode = createScope(['sv']);
  assert.strictEqual(findLineNumberRoot(sourceMode), sourceRoot);
  console.log('✅ testFindLineNumberRootCoversSupportedVditorModes passed');
}

function testCleanupLineNumberRootRemovesInjectedState() {
  const calls = [];
  const gutter = { remove: () => calls.push(['removeGutter']) };
  const anchor = {
    removeAttribute(name) {
      calls.push(['removeAnchorAttribute', name]);
    },
  };
  const root = {
    querySelector: () => gutter,
    querySelectorAll: () => [anchor],
    removeAttribute(name) {
      calls.push(['removeRootAttribute', name]);
    },
    style: {
      removeProperty(name) {
        calls.push(['removeStyle', name]);
      },
    },
  };

  cleanupLineNumberRoot(root);

  assert.deepStrictEqual(calls, [
    ['removeGutter'],
    ['removeAnchorAttribute', 'data-line-number-anchor'],
    ['removeAnchorAttribute', 'data-source-line'],
    ['removeAnchorAttribute', 'data-rendered-line-number'],
    ['removeAnchorAttribute', 'data-line-target-depth'],
    ['removeRootAttribute', 'data-has-line-numbers'],
    ['removeStyle', '--vditor-line-number-gutter-width'],
    ['removeStyle', '--vditor-line-number-padding-left'],
  ]);
  console.log('✅ testCleanupLineNumberRootRemovesInjectedState passed');
}

function testRovingLineNumbersExposeOneTabStop() {
  assert.deepStrictEqual(
    [0, 1, 2, 3].map((lineNumber) => getLineNumberTabIndex(lineNumber, 2, 4)),
    [-1, -1, 0, -1],
  );
  assert.deepStrictEqual(
    [0, 1, 2, 3].map((lineNumber) => getLineNumberTabIndex(lineNumber, null, 4)),
    [0, -1, -1, -1],
  );
  console.log('✅ testRovingLineNumbersExposeOneTabStop passed');
}

function testKeyboardNavigationResolvesRovingTargets() {
  assert.strictEqual(getLineNumberKeyboardTarget(2, 'ArrowUp', 5), 1);
  assert.strictEqual(getLineNumberKeyboardTarget(2, 'ArrowDown', 5), 3);
  assert.strictEqual(getLineNumberKeyboardTarget(2, 'Home', 5), 0);
  assert.strictEqual(getLineNumberKeyboardTarget(2, 'End', 5), 4);
  assert.strictEqual(getLineNumberKeyboardTarget(0, 'ArrowUp', 5), 0);
  assert.strictEqual(getLineNumberKeyboardTarget(4, 'ArrowDown', 5), 4);
  assert.strictEqual(getLineNumberKeyboardTarget(2, 'Enter', 5), null);
  console.log('✅ testKeyboardNavigationResolvesRovingTargets passed');
}

function testLineNumberStylesUseAttributeFallbackAcrossModes() {
  const styles = getLineNumberStyles();

  assert.ok(styles.includes('[data-has-line-numbers="true"]'));
  assert.ok(styles.includes('.vditor-ir'));
  assert.ok(styles.includes('.vditor-wysiwyg'));
  assert.ok(styles.includes('.vditor-sv'));
  assert.ok(!styles.includes(':has('), 'core gutter styles must work without CSS :has() support');
  console.log('✅ testLineNumberStylesUseAttributeFallbackAcrossModes passed');
}

test('returns line number from focused descendant', testReturnsLineNumberFromFocusedDescendant);
test('returns line number from focus node itself', testReturnsLineNumberFromFocusNodeItself);
test('falls forward when selection container is root at child boundary', testFallsForwardWhenSelectionContainerIsRootAtChildBoundary);
test('falls backward when selection offset is after last child', testFallsBackwardWhenSelectionOffsetIsAfterLastChild);
test('ignores anchors outside root', testIgnoresAnchorsOutsideRoot);
test('returns null without selection or root', testReturnsNullWithoutSelectionOrRoot);
test('line number layout scales with digits', testLineNumberLayoutScalesWithDigits);
test('should update active line when line number changes', testShouldUpdateActiveLineWhenLineNumberChanges);
test('should update active line when element changes for same line', testShouldUpdateActiveLineWhenElementChangesForSameLine);
test('should not update active line when selection remains cleared', testShouldNotUpdateActiveLineWhenSelectionRemainsCleared);
test('navigate to line element moves caret and reveals line', testNavigateToLineElementMovesCaretAndRevealsLine);
test('find line number root covers supported Vditor modes', testFindLineNumberRootCoversSupportedVditorModes);
test('cleanup line number root removes injected state', testCleanupLineNumberRootRemovesInjectedState);
test('roving line numbers expose one tab stop', testRovingLineNumbersExposeOneTabStop);
test('keyboard navigation resolves roving targets', testKeyboardNavigationResolvesRovingTargets);
test('line number styles use attribute fallback across modes', testLineNumberStylesUseAttributeFallbackAcrossModes);
