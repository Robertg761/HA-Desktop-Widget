# Testing Guide

This guide explains when and how to run tests for the HA Desktop Widget project.

## When to Run Tests

### Always Run Tests:

1. **Before committing code** - Ensure your changes don't break existing functionality
2. **After making changes to any `.js` file in `src/`** - Verify your changes work correctly
3. **Before creating a pull request** - Required for PR approval
4. **After pulling updates from main** - Confirm everything still works on your machine

### Optional But Recommended:

- **During development** - Use watch mode to get instant feedback as you code
- **After updating dependencies** - Make sure new packages don't break anything
- **When fixing bugs** - Verify the fix works and doesn't introduce new issues

## How to Run Tests

### Quick Start (Most Common)

```bash
# Run all tests (takes ~4-5 seconds)
npm test
```

**What you'll see:**
```
PASS tests/unit/state.test.js
PASS tests/unit/utils.test.js
PASS tests/unit/websocket.test.js
...
Test Suites: 11 passed, 11 total
Tests:       403 passed, 403 total
```

✅ **All tests passing?** You're good to commit!
❌ **Tests failing?** See "What to Do When Tests Fail" below.

### Run Tests with Coverage

```bash
# See which parts of your code are tested
npm test -- --coverage
```

This generates a coverage report showing which lines of code are tested. After running, open `coverage/lcov-report/index.html` in your browser to see detailed results.

**When to use:** When you want to see if your new code is adequately tested.

### Run Specific Test File

```bash
# Test only one module
npm test -- tests/unit/state.test.js

# Test integration tests
npm test -- tests/integration/websocket-state.test.js
```

**When to use:** When working on a specific module and you want faster feedback.

### Run Tests in Watch Mode

```bash
# Auto-rerun tests when files change
npm test -- --watch
```

**When to use:** During active development. Tests automatically rerun when you save changes.
**How to exit:** Press `q` to quit watch mode.

## What to Do When Tests Fail

### Step 1: Read the Error Message

Jest provides clear error messages showing:
- Which test failed
- What was expected vs. what actually happened
- The file and line number

Example:
```
FAIL tests/unit/state.test.js
  ● State Management › setConfig › should update CONFIG state

    expect(received).toEqual(expected)

    Expected: {"theme": "dark"}
    Received: {"theme": "light"}

      at Object.<anonymous> (tests/unit/state.test.js:45:23)
```

### Step 2: Fix the Issue

Common causes:
- **Your code has a bug** - Fix the logic in your source file
- **The test is outdated** - Update the test to match new behavior
- **You changed function signatures** - Update tests that call the changed function

### Step 3: Rerun Tests

After fixing, run `npm test` again to verify the fix.

### Step 4: Ask for Help (If Needed)

If you're stuck:
1. Check `testing-progress.md` for test implementation details
2. Look at similar tests in the same test file for patterns
3. Ask Claude Code or create a GitHub issue

## Quick Reference

| Command | Use Case |
|---------|----------|
| `npm test` | Run all tests (do this before commits) |
| `npm test -- --coverage` | See test coverage report |
| `npm test -- --watch` | Auto-rerun tests during development |
| `npm test -- tests/unit/state.test.js` | Run single test file |
| `npm run lint` | Check code style (also recommended before commits) |

## Test Statistics

- **403 tests** across 11 test suites
- **All tests should pass** before committing
- **Run time:** ~4-5 seconds for full suite
- **Coverage:** 35% overall, 77-100% on critical modules

## Additional Resources

- **Detailed test implementation:** See `testing-progress.md`
- **Writing new tests:** See the "Testing" section in `CLAUDE.md`
- **CI/CD:** Tests run automatically on every pull request

---

**Remember:** Tests are here to help you catch bugs early. Running them regularly saves time in the long run!
