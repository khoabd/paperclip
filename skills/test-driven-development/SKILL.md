---
name: test-driven-development
description: >
  Write tests before implementation code. Use for any new function, class, or
  API endpoint. Ensures code is testable, focused, and correct by design.
  Activate with: "write tests first", "TDD", "test-driven", "red-green-refactor".
---

# Test-Driven Development

Red → Green → Refactor. Always in that order.

## Process

1. **Write a failing test** — describe the desired behavior
2. **Run it** — confirm it fails (red)
3. **Write minimal code** — just enough to pass the test
4. **Run it** — confirm it passes (green)
5. **Refactor** — clean up without breaking tests
6. **Repeat** — for each behavior

## Test Anatomy

```python
def test_feature_behavior():
    # Arrange - set up inputs
    input = build_test_input()
    # Act - call the thing
    result = system_under_test(input)
    # Assert - verify output
    assert result == expected_output
```

## Coverage Targets
- Unit: 80%+ line coverage
- Integration: happy path + 2 error paths
- E2E: critical user journeys only

## Red Flags
- Writing tests after implementation
- Tests that test implementation details not behavior
- Mocking everything (no real integration)
- Tests that never fail
