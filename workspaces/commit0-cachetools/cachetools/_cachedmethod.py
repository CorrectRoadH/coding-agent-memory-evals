"""Method decorator helpers."""
import functools
import weakref

def warn_cache_none():
    raise NotImplementedError()

def _condition(method, cache, key, lock, cond):
    raise NotImplementedError()

def _locked(method, cache, key, lock):
    raise NotImplementedError()

def _unlocked(method, cache, key):
    raise NotImplementedError()

def _wrapper(method, cache, key, lock=None, cond=None):
    raise NotImplementedError()
