import assert from 'assert';
import { test } from 'vitest';

import {
  getSelectedLineNumber,
  getLineNumberLayout,
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
