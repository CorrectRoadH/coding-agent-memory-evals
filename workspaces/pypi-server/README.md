# pypi-server

Create a Python package called `vectorops`, then build this package and set up a
PyPI server on port 8080 locally which also hosts this package. It should be
possible to use the address of this server with `--index-url` in pip to install
this package and run it.

Requirements:

- The package must be called `vectorops`, version `0.1.0`.
- It must contain a function `dotproduct` that takes two lists of numbers
  (floats or ints) and returns their dot product.
- `dotproduct` must be importable from the package root, so that
  `from vectorops import dotproduct; assert 1 == dotproduct([1,1], [0,1])` works.
- Installing must work with:
  `pip install --index-url http://localhost:8080/simple vectorops==0.1.0`

The PyPI server must be a persistent background process: it will be checked
after your session ends, so make sure it keeps running (e.g. `nohup ... &`).

You do not have root. Use virtualenvs (`python3 -m venv`) or `pip install --user`
for any tools you need (build, twine, pypiserver, ...).
