"""`functools.lru_cache` compatible memoizing function decorators."""
__all__ = ('fifo_cache', 'lfu_cache', 'lru_cache', 'rr_cache', 'ttl_cache')
import functools
import math
import random
import time
from threading import Condition
from . import FIFOCache, LFUCache, LRUCache, RRCache, TTLCache
from . import cached
from . import keys

class _UnboundTTLCache(TTLCache):

    def __init__(self, ttl, timer):
        raise NotImplementedError()

    @property
    def maxsize(self):
        raise NotImplementedError()

def _cache(cache, maxsize, typed):
    raise NotImplementedError()

def fifo_cache(maxsize=128, typed=False):
    """Decorator to wrap a function with a memoizing callable that saves
    up to `maxsize` results based on a First In First Out (FIFO)
    algorithm.

    """
    raise NotImplementedError()

def lfu_cache(maxsize=128, typed=False):
    """Decorator to wrap a function with a memoizing callable that saves
    up to `maxsize` results based on a Least Frequently Used (LFU)
    algorithm.

    """
    raise NotImplementedError()

def lru_cache(maxsize=128, typed=False):
    """Decorator to wrap a function with a memoizing callable that saves
    up to `maxsize` results based on a Least Recently Used (LRU)
    algorithm.

    """
    raise NotImplementedError()

def rr_cache(maxsize=128, choice=random.choice, typed=False):
    """Decorator to wrap a function with a memoizing callable that saves
    up to `maxsize` results based on a Random Replacement (RR)
    algorithm.

    """
    raise NotImplementedError()

def ttl_cache(maxsize=128, ttl=600, timer=time.monotonic, typed=False):
    """Decorator to wrap a function with a memoizing callable that saves
    up to `maxsize` results based on a Least Recently Used (LRU)
    algorithm with a per-item time-to-live (TTL) value.
    """
    raise NotImplementedError()
