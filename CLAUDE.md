# Task

I have the old/ folder on root that were pretty badly built, so I'm refactoring it. I'm placing the new code on src/

# Constrains

1. No try-catch (except at the absolute outermost boundary if forced by external libraries, but immediately convert to a tuple return)
2. No any type
3. No else if or else (use early returns/guard clauses instead)
4. Minimum indentation as possible
5. Pay attention to performance and maintainability
6. When comparing or working with a list, use sets for better performance and maintainability

# Style

1. Prefer OOP
2. Non-private methods need the public keyword explicitly
3. All functions and methods must have an explicit return type
4. Use Go-style explicit error handling. Functions/methods that can fail must return a tuple: `Promise<[Error | null, ReturnType | null]>` (or synchronous equivalent). 
5. Always check for errors immediately after a function call (`if (err) return [err, null];`). Do not throw errors for control flow.
