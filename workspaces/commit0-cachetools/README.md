# commit0: cachetools

Implement the `cachetools` Python library from its specification.

The package skeleton in `cachetools/` keeps every public class, function
signature, and docstring, but all bodies raise `NotImplementedError`. The full
API specification is in `SPEC.rst`. The upstream unit test suite is in
`tests/` and must not be modified.

Implement the library so the entire test suite passes:

```
python3 -m pytest tests -rA -q
```

Rules:

- Do not install or vendor the `cachetools` package from PyPI; write the
  implementation in this repository.
- Do not change anything under `tests/`.
