## Coding

- Ensure good design:
  - maintain separation of concerns and state from logic
  - prioritize readability and maintainability
  - ensure overall design consistency before introducing ad-hoc or hardcoded solutions
  - when design decisions are unclear or ad-hoc solutions are considered, present up to three options with trade-offs before proceeding
  - callers should read as a high-level summary of the called logic
  - do not extract small, low-reuse logic into separate functions unless it improves readability

## Testing

- Tests are resource-intensive and may cause the machine to stop when run in bulk.
- Run only the tests required for the change, one at a time, with a 180-second timeout and at low priority.
