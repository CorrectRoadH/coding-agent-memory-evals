"""Extensible memoizing collections and decorators."""
__all__ = ('Cache', 'FIFOCache', 'LFUCache', 'LRUCache', 'RRCache', 'TLRUCache', 'TTLCache', 'cached', 'cachedmethod')
__version__ = '6.1.0'
import collections
import collections.abc
import functools
import heapq
import random
import time
from . import keys

class _DefaultSize:
    __slots__ = ()

    def __getitem__(self, _):
        raise NotImplementedError()

    def __setitem__(self, _, value):
        raise NotImplementedError()

    def pop(self, _):
        raise NotImplementedError()

class Cache(collections.abc.MutableMapping):
    """Mutable mapping to serve as a simple cache or cache base class."""
    __marker = object()
    __size = _DefaultSize()

    def __init__(self, maxsize, getsizeof=None):
        raise NotImplementedError()

    def __repr__(self):
        raise NotImplementedError()

    def __getitem__(self, key):
        raise NotImplementedError()

    def __setitem__(self, key, value):
        raise NotImplementedError()

    def __delitem__(self, key):
        raise NotImplementedError()

    def __contains__(self, key):
        raise NotImplementedError()

    def __missing__(self, key):
        raise NotImplementedError()

    def __iter__(self):
        raise NotImplementedError()

    def __len__(self):
        raise NotImplementedError()

    def get(self, key, default=None):
        raise NotImplementedError()

    def pop(self, key, default=__marker):
        raise NotImplementedError()

    def setdefault(self, key, default=None):
        raise NotImplementedError()

    @property
    def maxsize(self):
        """The maximum size of the cache."""
        raise NotImplementedError()

    @property
    def currsize(self):
        """The current size of the cache."""
        raise NotImplementedError()

    @staticmethod
    def getsizeof(value):
        """Return the size of a cache element's value."""
        raise NotImplementedError()

class FIFOCache(Cache):
    """First In First Out (FIFO) cache implementation."""

    def __init__(self, maxsize, getsizeof=None):
        raise NotImplementedError()

    def __setitem__(self, key, value, cache_setitem=Cache.__setitem__):
        raise NotImplementedError()

    def __delitem__(self, key, cache_delitem=Cache.__delitem__):
        raise NotImplementedError()

    def popitem(self):
        """Remove and return the `(key, value)` pair first inserted."""
        raise NotImplementedError()

class LFUCache(Cache):
    """Least Frequently Used (LFU) cache implementation."""

    class _Link:
        __slots__ = ('count', 'keys', 'next', 'prev')

        def __init__(self, count):
            raise NotImplementedError()

        def unlink(self):
            raise NotImplementedError()

    def __init__(self, maxsize, getsizeof=None):
        raise NotImplementedError()

    def __getitem__(self, key, cache_getitem=Cache.__getitem__):
        raise NotImplementedError()

    def __setitem__(self, key, value, cache_setitem=Cache.__setitem__):
        raise NotImplementedError()

    def __delitem__(self, key, cache_delitem=Cache.__delitem__):
        raise NotImplementedError()

    def popitem(self):
        """Remove and return the `(key, value)` pair least frequently used."""
        raise NotImplementedError()

    def __touch(self, key):
        """Increment use count"""
        raise NotImplementedError()

class LRUCache(Cache):
    """Least Recently Used (LRU) cache implementation."""

    def __init__(self, maxsize, getsizeof=None):
        raise NotImplementedError()

    def __getitem__(self, key, cache_getitem=Cache.__getitem__):
        raise NotImplementedError()

    def __setitem__(self, key, value, cache_setitem=Cache.__setitem__):
        raise NotImplementedError()

    def __delitem__(self, key, cache_delitem=Cache.__delitem__):
        raise NotImplementedError()

    def popitem(self):
        """Remove and return the `(key, value)` pair least recently used."""
        raise NotImplementedError()

    def __touch(self, key):
        """Mark as recently used"""
        raise NotImplementedError()

class RRCache(Cache):
    """Random Replacement (RR) cache implementation."""

    def __init__(self, maxsize, choice=random.choice, getsizeof=None):
        raise NotImplementedError()

    @property
    def choice(self):
        """The `choice` function used by the cache."""
        raise NotImplementedError()

    def popitem(self):
        """Remove and return a random `(key, value)` pair."""
        raise NotImplementedError()

class _TimedCache(Cache):
    """Base class for time aware cache implementations."""

    class _Timer:

        def __init__(self, timer):
            raise NotImplementedError()

        def __call__(self):
            raise NotImplementedError()

        def __enter__(self):
            raise NotImplementedError()

        def __exit__(self, *exc):
            raise NotImplementedError()

        def __reduce__(self):
            raise NotImplementedError()

        def __getattr__(self, name):
            raise NotImplementedError()

    def __init__(self, maxsize, timer=time.monotonic, getsizeof=None):
        raise NotImplementedError()

    def __repr__(self, cache_repr=Cache.__repr__):
        raise NotImplementedError()

    def __len__(self, cache_len=Cache.__len__):
        raise NotImplementedError()

    @property
    def currsize(self):
        raise NotImplementedError()

    @property
    def timer(self):
        """The timer function used by the cache."""
        raise NotImplementedError()

    def clear(self):
        raise NotImplementedError()

    def get(self, *args, **kwargs):
        raise NotImplementedError()

    def pop(self, *args, **kwargs):
        raise NotImplementedError()

    def setdefault(self, *args, **kwargs):
        raise NotImplementedError()

class TTLCache(_TimedCache):
    """LRU Cache implementation with per-item time-to-live (TTL) value."""

    class _Link:
        __slots__ = ('key', 'expires', 'next', 'prev')

        def __init__(self, key=None, expires=None):
            raise NotImplementedError()

        def __reduce__(self):
            raise NotImplementedError()

        def unlink(self):
            raise NotImplementedError()

    def __init__(self, maxsize, ttl, timer=time.monotonic, getsizeof=None):
        raise NotImplementedError()

    def __contains__(self, key):
        raise NotImplementedError()

    def __getitem__(self, key, cache_getitem=Cache.__getitem__):
        raise NotImplementedError()

    def __setitem__(self, key, value, cache_setitem=Cache.__setitem__):
        raise NotImplementedError()

    def __delitem__(self, key, cache_delitem=Cache.__delitem__):
        raise NotImplementedError()

    def __iter__(self):
        raise NotImplementedError()

    def __setstate__(self, state):
        raise NotImplementedError()

    @property
    def ttl(self):
        """The time-to-live value of the cache's items."""
        raise NotImplementedError()

    def expire(self, time=None):
        """Remove expired items from the cache and return an iterable of the
        expired `(key, value)` pairs.

        """
        raise NotImplementedError()

    def popitem(self):
        """Remove and return the `(key, value)` pair least recently used that
        has not already expired.

        """
        raise NotImplementedError()

    def __getlink(self, key):
        raise NotImplementedError()

class TLRUCache(_TimedCache):
    """Time aware Least Recently Used (TLRU) cache implementation."""

    @functools.total_ordering
    class _Item:
        __slots__ = ('key', 'expires', 'removed')

        def __init__(self, key=None, expires=None):
            raise NotImplementedError()

        def __lt__(self, other):
            raise NotImplementedError()

    def __init__(self, maxsize, ttu, timer=time.monotonic, getsizeof=None):
        raise NotImplementedError()

    def __contains__(self, key):
        raise NotImplementedError()

    def __getitem__(self, key, cache_getitem=Cache.__getitem__):
        raise NotImplementedError()

    def __setitem__(self, key, value, cache_setitem=Cache.__setitem__):
        raise NotImplementedError()

    def __delitem__(self, key, cache_delitem=Cache.__delitem__):
        raise NotImplementedError()

    def __iter__(self):
        raise NotImplementedError()

    @property
    def ttu(self):
        """The local time-to-use function used by the cache."""
        raise NotImplementedError()

    def expire(self, time=None):
        """Remove expired items from the cache and return an iterable of the
        expired `(key, value)` pairs.

        """
        raise NotImplementedError()

    def popitem(self):
        """Remove and return the `(key, value)` pair least recently used that
        has not already expired.

        """
        raise NotImplementedError()

    def __getitem(self, key):
        raise NotImplementedError()
_CacheInfo = collections.namedtuple('CacheInfo', ['hits', 'misses', 'maxsize', 'currsize'])

def cached(cache, key=keys.hashkey, lock=None, condition=None, info=False):
    """Decorator to wrap a function with a memoizing callable that saves
    results in a cache.

    """
    raise NotImplementedError()

def cachedmethod(cache, key=keys.methodkey, lock=None, condition=None):
    """Decorator to wrap a class or instance method with a memoizing
    callable that saves results in a cache.

    """
    raise NotImplementedError()
