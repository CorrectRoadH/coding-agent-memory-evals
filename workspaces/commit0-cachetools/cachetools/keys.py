"""Key functions for memoizing decorators."""
__all__ = ('hashkey', 'methodkey', 'typedkey', 'typedmethodkey')

class _HashedTuple(tuple):
    """A tuple that ensures that hash() will be called no more than once
    per element, since cache decorators will hash the key multiple
    times on a cache miss.  See also _HashedSeq in the standard
    library functools implementation.

    """
    __hashvalue = None

    def __hash__(self, hash=tuple.__hash__):
        raise NotImplementedError()

    def __add__(self, other, add=tuple.__add__):
        raise NotImplementedError()

    def __radd__(self, other, add=tuple.__add__):
        raise NotImplementedError()

    def __getstate__(self):
        raise NotImplementedError()
_kwmark = (_HashedTuple,)

def hashkey(*args, **kwargs):
    """Return a cache key for the specified hashable arguments."""
    raise NotImplementedError()

def methodkey(self, *args, **kwargs):
    """Return a cache key for use with cached methods."""
    raise NotImplementedError()

def typedkey(*args, **kwargs):
    """Return a typed cache key for the specified hashable arguments."""
    raise NotImplementedError()

def typedmethodkey(self, *args, **kwargs):
    """Return a typed cache key for use with cached methods."""
    raise NotImplementedError()
