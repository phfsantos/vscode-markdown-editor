# Production Hardening TODO

## Immediate Actions (Before Release)

### 1. Replace Debug Logging ⚠️ HIGH PRIORITY

**Status**: Logger utility created, needs implementation

**Files to update**:
- [ ] `src/app/EditorPanel.ts` - Replace 20+ console.log/warn/error
- [ ] `media-src/src/diff-visualizer.ts` - Replace 18+ console.log
- [ ] `src/sidebar/MarkdownSidebarProvider.ts` - Replace console.log/error
- [ ] `media-src/src/main.ts` - Replace console.log at lines 23, 108, 112
- [ ] `src/extension.ts` - Replace debug() function calls

**Find/Replace Pattern**:
```typescript
// OLD
console.log('[Sidebar-Debug]', message);

// NEW
import { logger } from '../utils/Logger';
logger.debug('Sidebar:', message);
```

### 2. Add Debug Logging Configuration

**Status**: Documentation created, needs package.json update

**File**: `package.json`

Add to `contributes.configuration.properties`:
```json
"markdown-editor.enableDebugLogging": {
  "type": "boolean",
  "default": false,
  "description": "Enable debug logging to console (for development and troubleshooting)"
}
```

### 3. Verify Package Exclusions

**Status**: Needs verification

**File**: `.vscodeignore`

Ensure these files/folders are excluded:
- [ ] `media/index.html` (development test file)
- [ ] `test/`
- [ ] `*.test.js`
- [ ] `.github/`
- [ ] `OBSIDIAN_SIDEBAR_PLAN.md`
- [ ] `TODO_PRODUCTION.md`
- [ ] `PRODUCTION_READINESS.md` (or include if helpful for users)

### 4. Run Test Suite

**Status**: ✅ Tests created and passing

```bash
yarn test:unit
```

Expected output: 4 test files, all passing

### 5. Clean Up Build Artifacts

**Status**: Needs manual check

- [ ] Remove any `.map` files from production build
- [ ] Verify `out/` directory is clean
- [ ] Check `media-dist/` and `sidebar-dist/` for unnecessary files

## Recommended Actions (Post-Release)

### 6. Add CHANGELOG

**Status**: Not started

Create `CHANGELOG.md` with version history:
```markdown
# Changelog

## [0.4.2] - TBD
### Added
- Production-safe logging utility
- Expanded test coverage (4 test files)
- Markdown linting configuration

### Changed
- Debug logs now gated behind setting

### Fixed
- Removed debug code from production builds
```

### 7. Performance Testing

**Status**: Not started

Test with:
- [ ] 100 markdown files
- [ ] 500 markdown files
- [ ] 1000+ markdown files

Monitor:
- Extension activation time
- Sidebar render time
- Graph generation time
- Memory usage

### 8. Security Audit

**Status**: Not started

```bash
yarn audit
# Fix any high/critical vulnerabilities
yarn audit --fix
```

### 9. Error Telemetry (Optional)

**Status**: Not started

Consider adding anonymous error reporting:
- VS Code built-in telemetry
- Custom error logging service
- GitHub Issues integration

### 10. Documentation Updates

**Status**: Partially complete

- [x] Production readiness report
- [ ] User-facing README updates
- [ ] API documentation for developers
- [ ] Troubleshooting guide

## Quality Gates

Before merging to `main`:
- [ ] All tests passing (`yarn test:unit`)
- [ ] TypeScript compiles without errors (`tsc -p ./`)
- [ ] Build succeeds (`yarn foy build`)
- [ ] Manual smoke test completed
- [ ] All console.log replaced with logger

Before publishing to marketplace:
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG updated
- [ ] README reviewed
- [ ] Screenshots updated (if UI changed)
- [ ] Security audit clean

## Notes for Future Maintenance

1. **Logging**: All new code should use the `logger` utility, not console.*
2. **Tests**: Add tests for new features before merging
3. **Performance**: Profile large workspace performance quarterly
4. **Dependencies**: Update monthly, audit for security

## Questions/Decisions Needed

1. Should we add telemetry? (Privacy implications)
2. Target VS Code version compatibility?
3. Support for multi-root workspaces?
4. Maximum workspace size recommendations?

---

**Created**: 2025-10-28
**Last Updated**: 2025-10-28
**Owner**: @phfsantos
